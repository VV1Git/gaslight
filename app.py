"""Small local web GUI for submitting Reddit posts from your own accounts."""

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import praw
import prawcore
from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
ACCOUNTS_FILE = Path(os.environ.get("ACCOUNTS_FILE", BASE_DIR / "accounts.json"))
HISTORY_FILE = BASE_DIR / "history.json"
USER_AGENT = "script:local-poster:v1.0 (by /u/{username})"

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # 20 MB image uploads

_clients = {}


def load_accounts():
    if not ACCOUNTS_FILE.exists():
        return []
    with open(ACCOUNTS_FILE) as f:
        return json.load(f).get("accounts", [])


def get_account(label):
    for acct in load_accounts():
        if acct["label"] == label:
            return acct
    raise KeyError(f"Unknown account: {label}")


def get_reddit(label):
    if label not in _clients:
        acct = get_account(label)
        _clients[label] = praw.Reddit(
            client_id=acct["client_id"],
            client_secret=acct["client_secret"],
            username=acct["username"],
            password=acct["password"],
            user_agent=USER_AGENT.format(username=acct["username"]),
        )
    return _clients[label]


def load_history():
    if not HISTORY_FILE.exists():
        return []
    with open(HISTORY_FILE) as f:
        return json.load(f)


def append_history(entry):
    history = load_history()
    history.insert(0, entry)
    with open(HISTORY_FILE, "w") as f:
        json.dump(history[:200], f, indent=2)


def error_message(exc):
    if isinstance(exc, praw.exceptions.RedditAPIException):
        return "; ".join(f"{item.error_type}: {item.message}" for item in exc.items)
    if isinstance(exc, prawcore.exceptions.OAuthException):
        return "Login failed - check username/password/client id/secret in accounts.json"
    if isinstance(exc, prawcore.exceptions.ResponseException):
        return f"Reddit returned HTTP {exc.response.status_code}"
    return str(exc)


@app.get("/")
def index():
    accounts = [{"label": a["label"], "username": a["username"]} for a in load_accounts()]
    return render_template(
        "index.html",
        accounts=accounts,
        accounts_file=str(ACCOUNTS_FILE),
        history=load_history()[:25],
    )


@app.get("/api/check/<label>")
def check_account(label):
    try:
        me = get_reddit(label).user.me()
        return jsonify(ok=True, username=me.name, karma=me.link_karma + me.comment_karma)
    except Exception as exc:
        _clients.pop(label, None)
        return jsonify(ok=False, error=error_message(exc)), 400


@app.get("/api/flairs")
def flairs():
    label = request.args.get("account", "")
    sub = request.args.get("subreddit", "").strip().removeprefix("r/")
    try:
        templates = get_reddit(label).subreddit(sub).flair.link_templates.user_selectable()
        return jsonify(ok=True, flairs=[
            {"id": t["flair_template_id"], "text": t["flair_text"]} for t in templates
        ])
    except Exception as exc:
        # Many subs don't expose flairs; not fatal.
        return jsonify(ok=False, flairs=[], error=error_message(exc))


@app.post("/api/submit")
def submit():
    form = request.form
    label = form.get("account", "")
    sub_name = form.get("subreddit", "").strip().removeprefix("r/")
    title = form.get("title", "").strip()
    kind = form.get("kind", "text")

    if not (label and sub_name and title):
        return jsonify(ok=False, error="Account, subreddit and title are required"), 400

    opts = {
        "title": title,
        "nsfw": form.get("nsfw") == "on",
        "spoiler": form.get("spoiler") == "on",
        "send_replies": form.get("send_replies", "on") == "on",
    }
    if form.get("flair_id"):
        opts["flair_id"] = form["flair_id"]

    tmp_path = None
    try:
        subreddit = get_reddit(label).subreddit(sub_name)
        if kind == "link":
            url = form.get("url", "").strip()
            if not url:
                return jsonify(ok=False, error="URL is required for link posts"), 400
            post = subreddit.submit(url=url, **opts)
        elif kind == "image":
            upload = request.files.get("image")
            if not upload or not upload.filename:
                return jsonify(ok=False, error="Choose an image to upload"), 400
            suffix = Path(upload.filename).suffix or ".jpg"
            fd, tmp_path = tempfile.mkstemp(suffix=suffix)
            with os.fdopen(fd, "wb") as f:
                upload.save(f)
            # without_websocket returns once the upload is accepted instead of
            # waiting for Reddit's media processing websocket.
            post = subreddit.submit_image(image_path=tmp_path, without_websocket=True, **opts)
        else:
            post = subreddit.submit(selftext=form.get("body", ""), **opts)
    except Exception as exc:
        return jsonify(ok=False, error=error_message(exc)), 400
    finally:
        if tmp_path:
            os.unlink(tmp_path)

    link = f"https://www.reddit.com{post.permalink}" if post else None
    append_history({
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "account": label,
        "subreddit": sub_name,
        "title": title,
        "kind": kind,
        "url": link,
    })
    return jsonify(ok=True, url=link)


if __name__ == "__main__":
    # Bound to localhost only: this app holds your Reddit passwords.
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)), debug=False)
