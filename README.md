# Reddit Poster

A web GUI for submitting text and link posts to Reddit from your own accounts.

## Hosted version (GitHub Pages)

The `docs/` folder is a static site that runs entirely in your browser and talks
to Reddit's official API directly. No server is involved.

**Turn it on (once):** repo **Settings → Pages → Build and deployment**, set
*Source* to **Deploy from a branch**, pick branch `claude/lucid-curie-9bs6rv` and
folder **`/docs`**, then save. After a minute it's live at
<https://vv1git.github.io/gaslight/>.

**First visit:** set a master password. Then add accounts with the form, or paste
an `accounts.json` into *Paste accounts as JSON*. Each account needs a Reddit
**script** app (see step 1 below for the client ID and secret).

**How your logins are stored:**
- They're encrypted in your browser's localStorage with AES-256-GCM. The key comes
  from your master password via PBKDF2-SHA256 with 600,000 iterations.
- The decrypted data and the master password live only in memory. The page locks
  when you click **Lock**, reload, or leave it idle for 15 minutes.
- Nothing goes into the repo, which matters because the repo and site are public.
  A content security policy stops the page from contacting anything except Reddit.
- Saved accounts are per browser and device. Forget the master password and the
  only fix is **Wipe saved data** and re-adding them.

**Limitations vs. the local version:** no image posts, because Reddit's image
upload doesn't accept requests from other websites. Accounts with 2FA don't work.

## Local version (Flask)

`app.py` is the original server-based version, which also supports image posts.

### Setup

1. **Create a Reddit app for each account** (or one shared app — see below):
   - Log in, go to <https://www.reddit.com/prefs/apps>, click *create another app*.
   - Pick **script**, give it any name, set redirect uri to `http://localhost:8080`.
   - The string under the app name is the **client_id**; *secret* is the **client_secret**.
   - A script app only works for accounts listed as its developers, so either make
     one app per account, or add your other accounts as developers on the app.

2. **Configure accounts:**
   ```sh
   cp accounts.example.json accounts.json
   ```
   Add one entry per account. `label` is just the name shown in the dropdown.
   `accounts.json` is gitignored — it holds your passwords, so don't commit it.

   > Accounts with 2FA: the password grant doesn't support 2FA cleanly
   > (you'd need `password:123456` with a fresh code each login). Use an account
   > without 2FA or disable it for that account.

3. **Install and run:**
   ```sh
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   python app.py
   ```
   Open <http://127.0.0.1:5000>. The server only listens on localhost.

### Using it

- Pick an account, hit **Test login** to confirm the credentials work.
- Enter a subreddit; available post flairs load automatically (some subs require one).
- Choose Text / Link / Image, fill in the title and content, and **Post**.
- Successful posts show up in *Recent posts* (stored in `history.json`).

Errors from Reddit (rate limits, missing flair, sub rules, etc.) are shown under
the form. New accounts are often rate-limited or filtered by subreddit karma/age rules.
Follow each subreddit's rules and Reddit's content policy; Reddit forbids using
multiple accounts to boost the same content or dodge bans.
