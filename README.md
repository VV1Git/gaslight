# Reddit Poster

A small local web GUI for submitting posts (text, link or image) to Reddit from
your own accounts, using Reddit's official API via [PRAW](https://praw.readthedocs.io).

## Setup

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

## Using it

- Pick an account, hit **Test login** to confirm the credentials work.
- Enter a subreddit; available post flairs load automatically (some subs require one).
- Choose Text / Link / Image, fill in the title and content, and **Post**.
- Successful posts show up in *Recent posts* (stored in `history.json`).

Errors from Reddit (rate limits, missing flair, sub rules, etc.) are shown under
the form. New accounts are often rate-limited or filtered by subreddit karma/age rules.
Follow each subreddit's rules and Reddit's content policy; Reddit forbids using
multiple accounts to boost the same content or dodge bans.
