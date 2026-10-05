# Reddit Drafts

A small web page for writing Reddit posts and opening them on Reddit's own
submit form with everything filled in. You check it and press Post yourself.
No API, no app, no passwords: you use the account you're already logged in as.

Live at <https://vv1git.github.io/gaslight/> once GitHub Pages is on.

## Turn on GitHub Pages (once)

Repo **Settings → Pages → Build and deployment**: set *Source* to **Deploy from a
branch**, pick branch `claude/lucid-curie-9bs6rv` and folder **`/docs`**, save.

## Using it

1. Enter the subreddit, a title, and the body (or a link), plus optionally which
   account it's meant for.
2. **Save & open on Reddit** opens `old.reddit.com/r/<sub>/submit` with the title
   and body filled in. Check it and press submit.
3. Back on the page, **Mark posted** moves it to the *Posted* tab.

Each draft also has **New Reddit** (same thing on www.reddit.com) and **Copy**
buttons in case a field doesn't fill in.

**Multiple accounts:** switch accounts on Reddit before you submit. The "Post as"
field is just a reminder of which account a draft is for.

Drafts are saved in your browser's localStorage, so they're per browser and
device. Nothing is sent anywhere until you submit on Reddit.
