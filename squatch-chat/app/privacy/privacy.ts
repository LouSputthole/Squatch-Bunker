// Campfire Online Privacy Policy, in the Markdown subset lib/legalMarkdown.ts
// renders. The HTML comment holds owner notes and is never shown on the page.
export const PRIVACY_MARKDOWN = `<!--
DRAFT - review with a lawyer before relying on it.

Owner notes (HTML comment: never rendered on the page):
- Every {{NAME}} below is filled from the constant of the same name in lib/legal.ts. Edit values there, not here.
- Providers named outright are the ones the code proves: Resend (lib/email.ts), GIPHY (app/api/gifs), LibreTranslate at libretranslate.com (app/api/translate default), GitHub/Google sign-in (app/api/auth/oauth), Google STUN (components/VoicePanel.tsx), GitHub for desktop update checks (desktop/main.cjs).
- Planned providers to confirm before launch (SUBPROCESSORS in lib/legal.ts): {{HOSTING_PROVIDER}} (planned: Fly.io, including the /app/media upload volume), {{DATABASE_PROVIDER}} (planned: Neon), {{TURN_PROVIDER}} (planned: a small VPS running coturn; name the VPS company).
- If LIBRETRANSLATE_URL is ever pointed at another instance, update the translation row in section 6.
- Sections 7 and 9 describe "Delete account" as lib/accountDeletion.ts implements it: personal data goes, what you posted for others stays under a "Deleted user" placeholder that the hourly guest sweep (lib/guestCleanup.ts) deletes once none of it remains. Keep them in sync with that file.
- Sections 2.3 and 8 say calls go directly between participants or through a relay that can't decrypt them. That stops being true if an SFU is configured (LIVEKIT_* in lib/sfu.ts): an SFU decrypts media. Revise before turning one on.
- This page renders ONLY when CAMPFIRE_EDITION=cloud (lib/legal.ts legalPagesEnabled).
- Section 4 gives legitimate interest as the basis for the Windows app's usage ping, which is on by default with an opt-out. Under the ePrivacy Directive Art. 5(3) and UK PECR reg. 6 (EDPB Guidelines 2/2023), storing and reading an install ID on a device for analytics may need prior consent in the EEA and UK, whatever the GDPR basis. Ask counsel before launch. If consent is needed, make the first-run notice ask before any ping (desktop/main.cjs) and change that row to consent.
- Section 13 shows {{EU_REPRESENTATIVE}} and {{UK_REPRESENTATIVE}} (GDPR Art. 27): ask counsel and fill them in lib/legal.ts, as "None appointed" if none is required.
- Section 2.1: a first Google sign-in makes the person's Google name (often their real full name) their public username without asking; GitHub uses the GitHub login. Consider prompting for a username at first sign-in, especially as 13-17 year olds can sign up.
- Images in messages from other websites (GIPHY GIFs, and any https image a client attaches) and GitHub/Google profile pictures load from those websites in every viewer's browser. Section 6 discloses this. Restricting remote attachments to GIPHY would not stop link-preview images doing the same.
-->

# Campfire Online Privacy Policy

**Effective date:** {{PRIVACY_EFFECTIVE_DATE}}

This policy explains what information Campfire Online collects, how we use it, who can see it, and the choices you have. "We", "us", and "our" mean {{OPERATOR_NAME}}, which runs Campfire Online at {{SERVICE_URL}} and is responsible for (the "controller" of) your personal information there.

## The short version

- We collect what a chat app needs to work: your account details, the things you post, and a little technical information.
- We don't sell your information, show ads, or use advertising or analytics trackers.
- Messages, direct messages (DMs), and files are stored on our servers and are **not end-to-end encrypted**. The people who run Campfire Online can technically read them, and we only look when we need to, for example to handle a report.
- Voice and video calls go directly between participants (or through a relay that can't decrypt them), and we never record them.
- The Windows app sends a small anonymous usage ping that isn't linked to your account, and you can turn it off.
- You can edit your profile, delete your messages, and delete your account in the app.

## 1. What this policy covers

This policy covers Campfire Online: the website, the web app, and the Campfire Windows app while it is connected to Campfire Online.

It doesn't cover other Campfire servers. Campfire is open-source software, so anyone can run their own server, and the Windows app can run a private one on your computer (**Host on this PC**). Whoever runs those servers decides how they handle your information. The only information we receive from them is the anonymous usage ping described in sections 2.6 and 2.7.

## 2. Information we collect

### 2.1 Account information

- **Registered accounts:** your email address, username, and password. We store your password only as a one-way bcrypt hash, never the password itself. We use your email address to sign you in and to send password-reset emails. Other users can't see it.
- **Signing in with GitHub or Google** (where we offer it): we receive your account ID with that provider, your verified email address, your name (Google) or username (GitHub), and a link to your profile picture. When we create your account, that name becomes your starting Campfire username, which other users can see (you can change it in Settings), and that picture becomes your avatar, which stays on GitHub's or Google's servers (see section 6). If that email address matches an existing Campfire Online account, we link the sign-in to that account. We never receive your GitHub or Google password.
- **Guest accounts:** only the name you choose. We add a random tag to it (for example, \`sam#k3j9x2ab\`). Guests don't give us an email address.
- **Profile details you choose to add:** avatar, banner, bio, and status message.
- **Settings:** for example, notification preferences and quiet hours.
- **Password resets:** when you ask for one, we store a hashed, single-use reset code that expires after one hour.

### 2.2 What you create and share

We store what you create so the Service can show it to you and to the people you share it with:

- camps you create (name, icon, banner, description, welcome message, roles, channels, and ambient sound settings), and your memberships and roles in camps;
- messages in channels, including replies, threads, pins, and reactions. If you edit a message, we keep only the latest version and the time it was edited;
- direct messages, their reactions, and whether they have been read;
- files you upload: images, PDFs, text files, and zip files, plus voice notes (up to 2 minutes), soundboard clips, and custom emoji. We store files exactly as you upload them, so **photos can include hidden details such as where they were taken**. Remove those details before uploading if you don't want to share them;
- polls and votes, gatherings and RSVPs, scheduled messages, bookmarks, and Camp Journal entries (private copies of messages you choose to save);
- friends, friend requests, and the people you block;
- private notes you write about other users (only you can see them);
- reports you file, reports filed about you (including a copy of a reported message, kept as evidence even if the message is deleted later), and appeals you make against a camp's moderation decision;
- moderation records: actions such as kicks and bans are logged in that camp's audit log;
- your inbox notifications, which can include a short preview of the message that triggered them.

When a message contains a link, our server visits that page to build a preview (its title, description, and image).

### 2.3 Voice, video, and screen sharing

Voice rooms, video, and screen sharing use WebRTC, which connects participants' devices directly to each other. Our server only helps participants find each other (this is called "signaling"). The audio and video don't pass through our server, and **we don't record or store calls**.

- Calls are always encrypted (with DTLS-SRTP).
- To connect directly, devices exchange network addresses, so **other people in a call can see your IP address**.
- When a direct connection isn't possible, the call is relayed through a TURN server run by or for us ({{TURN_PROVIDER}}). The relay carries only encrypted media that it can't decrypt. It sees your IP address, your Campfire user ID (which is part of the temporary relay login), and how much data it relays.
- To work out your network address, the app also contacts public STUN servers run by Google, which see your IP address.
- Who is in a voice room, and who is speaking, is shown live to the people in the camp and isn't stored afterwards. Side conversations inside a voice room ("Offshoots") are a convenience, not a private channel: everyone in the room stays connected to the same call.

Voice notes are different. They are recordings you choose to send, and we store them like any other file.

### 2.4 Technical information

- **IP addresses.** Our app uses your IP address in memory to limit repeated sign-up, sign-in, guest, and password-reset attempts. It isn't saved to our database, and it is discarded when the limit resets (within an hour). Like any website, our hosting provider's network may log connection details, including IP addresses (see section 7).
- **Server logs.** Our application logs record technical events, such as when an account (by username) connects to or disconnects from live chat, and errors.
- **Online status.** Whether you are online, idle, set to Do Not Disturb, or in a voice room is kept in memory and shown to people in your camps. It isn't stored.
- **Usage counts.** We count sign-ups and recently active accounts (people who posted) from our own database, to understand how Campfire Online is used. We don't use any third-party analytics.

### 2.5 Cookies and browser storage

We use one essential cookie, plus two short-lived cookies during GitHub or Google sign-in. We don't use advertising or analytics cookies, so there is no cookie banner.

| Cookie | What it's for | How long it lasts |
|---|---|---|
| \`squatch-token\` | Keeps you signed in. It is \`HttpOnly\` (scripts on the page can't read it) and is only sent over HTTPS. | 7 days, or until you log out |
| \`oauth_state_<provider>\` and \`oauth_next_<provider>\` | Protect GitHub or Google sign-in against forgery, and remember where to send you afterwards | 5 minutes, only during that sign-in |

The app also saves some things in your browser's local storage (or the Windows app's storage) so it works the way you left it. These stay on your device and are not sent to us: your theme and custom colors; audio and video settings (including which microphone, speakers, and camera you chose); recently used emoji; collapsed categories; unread markers and last-read times; muted channels; the last voice room you were in; your personal word filter for each camp; and **drafts of messages you haven't sent yet**. Drafts stay on the device after you log out, so on a shared computer, clear this site's data in your browser when you're done.

### 2.6 The Windows app

- **Anonymous usage ping.** About 20 seconds after it starts, and then once a day while it runs, the app sends us one small message containing: a random install ID created on your computer, whether the app is connected to Campfire Online or hosting on your PC, the app version, and your operating system and processor type (for example, \`win32-x64\`). It **doesn't** include your name, email address, Campfire account, IP address, computer name, or anything you have written, and it isn't linked to your Campfire account. The first time you start the app, it tells you about the ping and waits 5 minutes before sending one, so you can turn it off first. To turn it off at any time, right-click the Campfire tray icon and untick **Send anonymous usage ping** (setting \`DO_NOT_TRACK=1\` on your computer also turns it off). We keep one record per install, which each ping overwrites and which we delete 90 days after the last ping. We use your IP address only in memory, to limit how many pings we accept, and never store it. Full details are in [TELEMETRY.md](https://github.com/LouSputthole/Squatch-Bunker/blob/main/squatch-chat/docs/TELEMETRY.md).
- **Update checks.** About 15 seconds after it starts, the app asks GitHub whether a newer version is available, so GitHub sees your IP address. App downloads are also served by GitHub.

### 2.7 Self-hosted Campfire servers

Campfire servers that other people run in production send us a similar anonymous ping unless their operator turns it off. It contains an install ID derived from a secret on that server, the Campfire version and edition, the operating system, and two totals: how many registered accounts the server has and how many of them posted in the last 7 days. It contains no information about any individual person.

## 3. How we use information

We use information to:

- **run the Service:** create and secure your account, sign you in, store and deliver your messages and files, connect calls, show notifications, and remember your settings;
- **keep people safe:** handle reports, enforce our [Terms](/terms), prevent spam and abuse, and investigate security problems;
- **help you:** send password-reset emails and answer your questions;
- **understand and improve Campfire:** count accounts, active users, and installs, and find and fix bugs;
- **comply with the law:** respond to valid legal requests and meet our legal obligations, such as reporting child sexual exploitation.

Right now, the only emails we send are the password-reset emails you ask for. We may also email you about important changes to the Service or to our Terms or this policy.

**When we look at your content.** Because messages, DMs, and files aren't end-to-end encrypted, the people who run Campfire Online can technically access them. We access them only when we need to: to investigate a report or suspected abuse, to keep the Service secure and working, or to comply with the law.

## 4. Legal bases (EEA and UK)

If you are in the European Economic Area or the United Kingdom, we rely on the following legal bases:

| What we do | Legal basis |
|---|---|
| Provide your account, messages, files, calls, sign-in (including with GitHub or Google), and other features | Performing our contract with you (the Terms) |
| Security, rate limiting, preventing spam and abuse, moderation, and server logs | Our legitimate interest in keeping Campfire Online safe and working |
| Counting accounts, activity, and installs, including the anonymous usage ping | Our legitimate interest in understanding how Campfire is used. You can turn off the ping at any time. |
| Responding to legal requests, reporting child exploitation, and keeping records the law requires | Complying with our legal obligations, or, where an obligation comes from outside the EEA or UK, our legitimate interest in protecting people and complying with the law |

## 5. Who can see your information

- **Anyone with the link:** banners, camp icons, and custom emoji are stored at hard-to-guess but public web addresses, and profile pictures you upload at public addresses based on your user ID, which other users can see. Anyone who has the link can open them, even without an account.
- **Any signed-in user (including guests):** your username, avatar, banner, bio, status message, and online status, and the name, icon, description, and member count of camps listed in Explore. Anyone with a camp's invite link can preview that camp. Other users can't see your email address.
- **People in your camps and channels:** what you post there, and when. People who can see a message can reply to it, react to it, save a private copy to their Camp Journal, and see its link previews.
- **Camp owners and moderators**, depending on their permissions, can also delete messages, kick or ban members, see the camp's audit log, set channels to delete messages automatically, and export a channel's message history (including usernames). They see reports filed in their camp, about messages or members, including the username of the person who reported it, the reported message as it was when reported, the case's history, and any appeal; the people who run Campfire Online can see every message report too (see the [Terms](/terms), section 8).
- **People you DM:** your messages with them.
- **Us:** everything we store, used as described in section 3.

## 6. Who we share information with

We share information only as described here.

**Service providers** run parts of Campfire Online for us. They may use your information only to provide their service to us.

| Provider | What they do | What they handle |
|---|---|---|
| {{HOSTING_PROVIDER}} | Hosts the Campfire Online servers and stores uploaded files | All Service data and connection information |
| {{DATABASE_PROVIDER}} | Hosts our database | Account information and content |
| Resend | Sends password-reset emails | Your email address, username, and the reset link |
| {{TURN_PROVIDER}} | Runs the relay for calls that can't connect directly | Encrypted call media, IP addresses, and user IDs |

**Features that contact other services.** Some features send information to other companies when you or other people use them. Those companies' own privacy policies apply.

| Feature | Service | What it receives |
|---|---|---|
| GIF search (when available) | GIPHY | Your search terms, sent from our server and not linked to your account. When you view a GIF, your device loads it from GIPHY, which sees your IP address. |
| Translate (on a message) | LibreTranslate (libretranslate.com) | The text of the message you translate, sent from our server |
| Link previews | The linked website | A request from our server for the page. If the preview has an image, each viewer's device loads it from that website, which sees their IP address. |
| GIFs and other images from websites, attached to messages | The website that hosts the image (GIPHY, for GIFs) | Each viewer's device loads the image from that website, which sees their IP address. |
| Sign in with GitHub or Google (when offered) | GitHub or Google | That you are signing in to Campfire Online |
| Profile pictures that come from GitHub or Google sign-in | GitHub or Google | Each viewer's device loads the picture from GitHub or Google, which sees their IP address. |
| Voice and video calls | Google (STUN servers) | Your IP address, to help set up the call |
| Windows app downloads and update checks | GitHub | Your IP address |

**Legal and safety reasons.** We may preserve or disclose information if we believe in good faith that it is needed to comply with the law or a valid legal process, to protect someone from death or serious harm, to prevent fraud or abuse, or to protect the rights and safety of our users or us. We report apparent child sexual exploitation to the National Center for Missing & Exploited Children (NCMEC), as US law requires.

**Business transfers.** If {{OPERATOR_NAME}} is involved in a merger, acquisition, or sale of assets, information may be transferred as part of that deal. The new owner would have to follow this policy or tell you about any changes.

**No selling, no ads.** We don't sell your personal information or share it for targeted advertising, and we haven't done so in the past 12 months.

## 7. How long we keep information

| Information | How long we keep it |
|---|---|
| Account and profile | Until you delete your account (section 9 explains what that deletes and what stays) |
| Messages in camps | Until you, a moderator, or the camp owner deletes them, including by deleting the channel or the camp. In leave-no-trace channels, messages are deleted automatically once they are 1, 7, or 30 days old (the camp chooses), by a cleanup that runs every hour. Deleting your account doesn't delete them (see section 9). |
| Direct messages | As long as the conversation exists. Deleting individual DMs isn't available yet. If you delete your account, the DMs you sent stay in the other person's conversation, shown as "Deleted user". Once both people have deleted their accounts, the conversation is deleted. |
| Files | As long as a message, DM, or Journal entry uses them. Files that are uploaded but never sent are deleted after about a day. When the last message using a file is deleted, the file is deleted too. |
| Camp Journal entries | Until the person who saved them removes them or deletes their account. They are copies, so they stay even if the original message is deleted or expires. |
| Inbox notifications | Until you clear them. They can include a short preview of a message even after that message is deleted. |
| Guest accounts | A guest can use the account for 24 hours. After that, an hourly cleanup deletes the guest account and its data. If it left something other people still use (messages, DMs, polls, gatherings, or a camp it created), or a report it filed or one about it is still open, only the guest name stays with those things until they are removed or the report is closed. Its profile, reactions, votes, Journal entries, and other personal data are deleted. |
| Password-reset codes | 1 hour, single use |
| Reports | As long as needed to handle them and to deal with repeated abuse. When you delete your account, the reports you filed are deleted, except ones that are still open, which stay (under "Deleted user") until they are handled. Reports about an account stay until that account is fully removed (see section 9). |
| Rate-limit records (IP addresses) | In memory only, for up to an hour |
| Install ping records | Deleted 90 days after the last ping |
| Server and hosting logs | {{LOG_RETENTION}} |
| Backups | Deleted information can remain in backups for up to {{BACKUP_RETENTION}}, after which those backups are deleted or overwritten |
| Session cookie | 7 days, or until you log out |

We may keep information longer if the law requires it, or when we need it to investigate abuse or protect someone's safety.

## 8. Security

- All traffic to Campfire Online, including live chat, is encrypted with HTTPS (TLS).
- Passwords are stored as bcrypt hashes. Your session cookie can't be read by scripts on the page, and resetting your password signs out your other sessions.
- Files attached to messages and DMs are served only to people who can currently see that message, DM, or Journal entry. Profile pictures, banners, camp icons, and custom emoji are public to anyone who has the link.
- Calls are encrypted between participants' devices. Because our server introduces participants to each other, someone in control of our server could in theory insert themselves while a call is being set up; this is true of WebRTC apps in general.
- **Not end-to-end encrypted:** messages, DMs, and files are stored in a form our systems can read, which is what makes search, message history for new members, and moderation work.
- Campfire Online doesn't offer two-factor authentication yet, so please use a strong password that you don't use anywhere else.

No system is perfectly secure. If a breach affects your information, we will notify you and the authorities as the law requires. If you find a security vulnerability, please report it privately through a security advisory at <https://github.com/LouSputthole/Squatch-Bunker>.

## 9. Your choices and rights

**In the app, at any time, you can:**

- **edit your profile:** change your username, avatar, and status message in Settings, and your bio and banner on your profile;
- **delete content:** delete your own messages in camps; remove your Journal entries, bookmarks, and RSVPs; clear notifications; and leave camps;
- **export:** download your Camp Journal for a camp. Camp moderators who can manage channels can also export a channel's messages;
- **control who reaches you:** block people, mute channels, and set notification preferences and quiet hours;
- **delete your account:** go to Settings, then Account, then **Delete account**, and confirm with your username (and your password, if your account has one). If you own any camps, delete them first; camps can't be handed to someone else yet. Deleting your account signs you out everywhere and permanently deletes your email address, password, profile (avatar, banner, bio, and status message), GitHub or Google sign-in links, camp memberships and "joined the server" notices, friends and friend requests, the people you blocked, your private notes, bookmarks, Camp Journal entries, reactions, poll votes, RSVPs, scheduled messages, notifications and notification settings (and notices about you in other people's inboxes), the reports you filed that have been handled, and files that nothing else uses (including your uploaded avatar and banner). Reports you filed that are still open stay, under "Deleted user", until they are handled. What you posted for other people (messages in camps, direct messages, and the polls and gatherings you created) stays where it is, shown as "Deleted user" instead of your username, so other people's conversations still make sense. Delete any camp messages you don't want to leave behind first, or ask us to remove content you can't delete yourself (see below). Once none of that content is left, the "Deleted user" placeholder is deleted too. Copies that other people saved (such as their Camp Journal entries or channel exports) may remain, and so may copies in backups until they expire (see section 7);
- **turn off the usage ping** in the Windows app's tray menu.

**By asking us:** email {{CONTACT_EMAIL}} from the email address on your account to ask for a copy of your information, to correct something you can't change in the app (such as your email address), or for help deleting it. We may need to confirm that the request comes from you. We will respond within one month, or within any shorter time the law where you live requires.

**EEA and UK residents** have the right to access, correct, and delete their personal information, to receive a portable copy of it, to restrict or object to our use of it (including use based on our legitimate interests), and to withdraw consent where we rely on consent. You also have the right to complain to your local data protection authority (in the UK, the Information Commissioner's Office).

**California residents, and residents of other US states with privacy laws,** have the right to know what personal information we collect, use, and disclose; to access, correct, and delete it; and not to be treated differently for using these rights. We don't sell or share personal information for targeted advertising, so there is nothing to opt out of. We use sensitive information (your account login and the contents of your messages) only to provide the Service. You may make a request through an authorized agent; we may ask them for proof that you authorized them. If we deny your request, you can appeal by replying to our answer.

In the past 12 months, we collected the following categories of personal information, from you, from your device, and (if you use them) from GitHub or Google:

| Category | Examples | Disclosed for business purposes to |
|---|---|---|
| Identifiers | Email address, username, user ID, IP address | Hosting, database, email, and TURN providers; Google (STUN servers, IP addresses only) |
| Customer records | Email address and password hash | Hosting and database providers |
| Internet or network activity | How you use the Service, server logs | Hosting provider |
| Audio and visual information | Uploaded images, voice notes, soundboard clips, avatars (not live calls) | Hosting and database providers |
| Sensitive personal information | Account login details; the contents of your messages and DMs | Hosting and database providers; LibreTranslate (only the text of a message someone chooses to translate) |

## 10. International transfers

Campfire Online's servers are located in {{HOSTING_REGION}}, and our service providers may process information in other countries. If you use Campfire Online from somewhere else, your information is transferred to those countries, whose data protection laws may differ from yours. Where the law requires, we rely on safeguards such as the European Commission's Standard Contractual Clauses (and the UK's equivalent) in our agreements with service providers.

## 11. Children

Campfire Online isn't directed to children under 13, and we don't knowingly collect personal information from them. Users aged 13 to 17 need permission from a parent or guardian (see our [Terms](/terms)). If you believe a child under 13 has given us personal information, email {{CONTACT_EMAIL}} and we will delete it.

## 12. Changes to this policy

We may update this policy from time to time. When we do, we will post the new version on this page with a new effective date. If a change is material, we will post a notice on this page and email registered accounts before it takes effect.

## 13. Contact us

- **Privacy questions and requests:** {{CONTACT_EMAIL}}
- **Mail:** {{OPERATOR_NAME}}, {{MAILING_ADDRESS}}
- **Representative in the EU (GDPR Article 27):** {{EU_REPRESENTATIVE}}
- **Representative in the UK (UK GDPR Article 27):** {{UK_REPRESENTATIVE}}

If you are in the EEA or UK, you can also contact your local data protection authority.
`;
