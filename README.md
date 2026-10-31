# Kaam

The family's pending work, in one place. Each person signs in with their own PIN once per phone and stays signed in. All documents are saved in the admin's Google Drive.

## What's inside

- `index.html`, `app.js`, `app.css`, `diff.js`: the app
- `api/auth.js`: sign-in and PIN changes (5 wrong tries locks that person for 15 minutes)
- `api/data.js`: tasks, people, lists, change log and undo
- `api/upload.js`: sends documents to Google Drive
- `api/google.js`, `api/_drive.js`: the Google Drive connection and folder handling
- `manifest.webmanifest` and icons: so "Add to Home Screen" opens it like an app

No packages to install.

## Part 1: Put it on Vercel (about 10 minutes)

1. **GitHub.** Create a new **private** repository called `kaam`. Click **uploading an existing file**, drag in everything from this folder (including the `api` folder), and commit.
2. **Vercel.** Go to vercel.com → **Add New → Project** → import `kaam`. Framework preset: **Other**.
   Before clicking Deploy, open **Environment Variables** and add:
   - `ADMIN_PIN` = the admin's PIN (4 to 8 digits)

   Then click **Deploy**.
3. **Database: reuse Hisaab's.** In the new project, open **Storage**. Hisaab's Upstash Redis database is listed there: click **Connect** and connect it to this project. If it asks for an environment variable prefix, leave it as it is. Kaam's data is kept separate from Hisaab's inside the same database.
4. **Redeploy.** Open **Deployments**, click the latest one → **Redeploy**.
5. **Note your link.** It looks like `https://kaam-something.vercel.app`. Always use this exact link (not the long one with random letters that Vercel also shows), because Google will only accept this one.

## Part 2: Let Kaam use Google Drive (about 15 minutes, once)

Do this on a laptop, signed in to **your personal Google account** (the one with 1 TB).

1. Go to **console.cloud.google.com**. At the top, click the project picker → **New project**. Name it `Kaam` → **Create**, then make sure `Kaam` is selected at the top.
2. In the search bar, type **Google Drive API**, open it, and click **Enable**.
3. In the search bar, type **Google Auth Platform** and open it (on some screens it's called **OAuth consent screen**). Click **Get started**:
   - App name: `Kaam`. User support email: your email. **Next**.
   - Audience: **External**. **Next**.
   - Contact email: your email. **Next**, tick the agreement, **Create**.
4. Still in Google Auth Platform, open **Audience** and click **Publish app** → **Confirm**. The status should say **In production**. (If you skip this, the Drive connection stops working every 7 days.)
5. Open **Clients** → **Create client**:
   - Application type: **Web application**. Name: `Kaam`.
   - Under **Authorised redirect URIs**, click **Add URI** and paste your link with `/api/google` on the end, for example `https://kaam-something.vercel.app/api/google`
   - Click **Create**. A box shows a **Client ID** and **Client secret**. Copy both (there's a download button too).
6. Back in Vercel → your Kaam project → **Settings → Environment Variables**, add:
   - `GOOGLE_CLIENT_ID` = the Client ID
   - `GOOGLE_CLIENT_SECRET` = the Client secret
7. **Redeploy** again (Deployments → latest → Redeploy).

## Part 3: First sign-in

1. Open your Kaam link and sign in as **Admin** with `ADMIN_PIN`.
2. **More → Connect Google Drive.** Pick your personal Google account. Google will say **"Google hasn't verified this app"**. That's expected for a personal app: click **Advanced → Go to Kaam (unsafe)**, then **Continue**. You land back in Kaam with "Google Drive connected", and a **Kaam** folder appears in your Drive.
3. **More → Add a person** for Mom, Dad, your sister and yourself. Give each a PIN and their **Gmail address**. Kaam shares the Kaam folder with them (view only), and Google emails them about it.
4. Share the link. On each phone: open it in Chrome or Safari → **Add to Home Screen**. On iPhone, the Google Drive app must be installed and signed in, so documents open without asking for a login.

## How documents are organised in Drive

```
Kaam/
  Re-KYC for Dad's HDFC account/
    2026-10-21 Handed KYC form with Aadhaar and PAN.jpg   (attached with an update)
    Aadhaar copy.jpg                                      (attached to a needed item)
    Removed/                                              (removed or cancelled files)
  Property tax payment (Done Oct 2026)/
  Deleted tasks/
```

- Kaam names and moves files itself. Renaming a task renames its folder; finishing a task adds "(Done …)".
- Please don't move or delete files inside the Kaam folder by hand. Kaam can only manage files it made, and it loses track of moved ones.
- Kaam can only see files it created. It can't see anything else in your Drive.

## Good to know

- **Everything is open to the family.** Every task and document is visible to everyone signed in.
- **Admin only:** people and PINs, Gmail sharing, Google Drive, deleting tasks, and undoing other people's changes. The Admin profile doesn't appear in task lists or to-dos.
- **Undo.** More → Change log lists every change. Undo reverses just that one change and leaves later ones alone.
- **Someone forgot their PIN?** The admin sets a new one in More → People.
- **Forgot the admin PIN?** In Upstash, delete the key `kaam:config`. `ADMIN_PIN` from Vercel works again. Tasks and documents are untouched, but you'll need to add the family members again.
- **"The Google Drive connection stopped working"**: the admin opens More → **Reconnect**. Always reconnect with the same Google account.
