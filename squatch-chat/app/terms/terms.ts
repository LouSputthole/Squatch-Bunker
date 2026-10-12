// Campfire Online Terms of Service, in the Markdown subset lib/legalMarkdown.ts
// renders. The HTML comment holds owner notes and is never shown on the page.
export const TERMS_MARKDOWN = `<!--
DRAFT - review with a lawyer before relying on it.

Owner notes (HTML comment: never rendered on the page):
- Every {{NAME}} below is filled from the constant of the same name in lib/legal.ts. Edit values there, not here.
- {{GOVERNING_LAW}}: suggested default "Tennessee" (the owner appears to be based there). Confirm with counsel. {{VENUE}} is the county/city whose courts hear disputes.
- There is deliberately NO arbitration clause or class-action waiver. Add one only on a lawyer's advice (it would need an opt-out window and conspicuous placement).
- Section 6.3 bans sexually explicit content everywhere because Campfire Online admits 13-17 year olds and has no age-gated spaces. Revisit only if age-gating ships.
- Section 14 points to "Settings -> Account -> Delete account" (components/DeleteAccountSettings.tsx, DELETE /api/auth/me, lib/accountDeletion.ts).
- Sections 3 and 10 say calls go directly between participants or through a relay that can't decrypt them. That stops being true if an SFU is configured (LIVEKIT_* in lib/sfu.ts): an SFU decrypts media. Revise both documents before turning one on.
- This page renders ONLY when CAMPFIRE_EDITION=cloud (lib/legal.ts legalPagesEnabled). Self-hosted servers and "Host on this PC" are run by their own operators and never show these Terms.
- Assent: the only mechanism is the consent line above the sign-up buttons (components/LegalConsent.tsx), which also carries the section 2 age statement. There is no checkbox, no server-side age check, and no stored record of which Terms version a user accepted or when. Ask counsel whether that is enough to rely on sections 16-18, and whether to add a required "13 or older" checkbox and a termsAcceptedAt/termsVersion record.
- Section 4 (guests), the appeals paragraph of section 7, and section 8 (reports) match lib/guestCleanup.ts and lib/reports.ts: a report goes to the camp's Ranger Desk (moderators see the reporter's username and the message kept as evidence); the operator sees reports with no camp, reports a camp escalated, and every message report on /admin for 30 days whatever the camp decided; a warned, kicked, or banned member can appeal to the camp once within 14 days. Keep them in sync.
- Section 7 ("we may remove any content ... suspend or ban accounts") and section 9 (DMCA takedowns, repeat infringers) rely on the manual runbook in docs/LAUNCH.md step 12: /admin can close a report and remove its message, but there is no instance-wide ban yet.
- Section 13 says nothing can be bought. Setting the Stripe variables on Campfire Online turns paid tiers on (lib/edition.ts billingConfiguration), and the server then logs a warning. Rewrite section 13 (price, renewal, cancellation, refunds) BEFORE turning billing on.
- Section 19 promises 30 days' notice of material changes by email. There is no in-app broadcast and lib/email.ts sends only password resets, so send that notice to registered accounts yourself (for example through Resend). Guests have no email, but no guest account lasts longer than 24 hours.
-->

# Campfire Online Terms of Service

**Effective date:** {{TERMS_EFFECTIVE_DATE}}

Welcome to Campfire Online, a free place to hang out with your friends and communities in text, voice, and video. These Terms of Service ("Terms") are an agreement between you and {{OPERATOR_NAME}} ("we", "us", "our"), which runs Campfire Online at {{SERVICE_URL}}. They cover the website, the web app, and the Campfire Windows app while it is connected to Campfire Online (together, the "Service").

Please read them together with our [Privacy Policy](/privacy) and the community rules in section 6. Each section starts with a one-line summary to help you skim; the full text of each section is what counts.

## 1. Agreeing to these Terms

> **In short:** Using Campfire Online means you agree to these Terms. If you don't agree, please don't use it.

By creating an account, joining as a guest, or otherwise using the Service, you agree to these Terms. If you use the Service for a group or organization, you confirm you're allowed to accept these Terms on its behalf.

## 2. Who can use Campfire Online

> **In short:** You must be at least 13. If you're under 18, you need a parent's or guardian's permission.

- You must be at least 13 years old. Campfire Online is not directed to children under 13, and we don't knowingly allow them to use it. If we learn that an account belongs to someone under 13, we will delete it.
- If you are between 13 and 18 (or under the age of adulthood where you live), you may use the Service only with the permission of a parent or legal guardian, who agrees to these Terms for you and is responsible for your use of the Service.
- If the law where you live sets a higher age for using online services without a parent's consent (some European countries set it as high as 16), you need that consent until you reach that age.
- You may not use the Service if we have banned you from it before, or if the law does not allow you to use it.

## 3. What Campfire Online is

> **In short:** A free, hosted Campfire that we run. It comes as-is, without uptime guarantees, and it will change over time.

Campfire Online lets you create and join communities ("camps"), chat in channels and direct messages, share files, and talk in voice and video rooms.

**This Service only.** Campfire is open-source software that anyone can run. These Terms apply only to Campfire Online, the instance we run. They don't apply to:

- a Campfire server that someone else hosts ("self-hosted"), or
- the Windows app's **Host on this PC** mode, which runs a private Campfire on your own computer.

Whoever runs those servers is responsible for them and sets their own rules.

**Free, without guarantees.** The Service is free and is provided "as is" and "as available" (see section 15). We don't promise any particular uptime, and there is no service-level agreement. We may add, change, or remove features, and some features are early or experimental. Voice and video connect participants directly to each other, and calls may not connect on every network.

**Keep your own copies.** We back up the Service, but we can't promise that nothing will ever be lost. If something matters to you, keep a copy of it.

## 4. Your account

> **In short:** Keep your login safe, choose a username that doesn't mislead anyone, and remember that guest accounts expire after 24 hours.

**Registered accounts.** To register, you give us an email address, a username, and a password, or you sign in with GitHub or Google where we offer that. Use an email address you control: it is how you reset your password.

**Guest accounts.** Where we offer guest access, you can join with just a name. Guest accounts are temporary. A guest session ends 24 hours after it starts, and after that the guest account can't be signed into or upgraded. To keep a guest account, upgrade it to a registered account before it expires. After a guest account expires, we delete it. If it left something other people still use, such as messages in their conversations, polls or gatherings, or a camp it created, we keep only the guest name with those things until they are removed; its profile and other personal data are deleted.

**Keep it secure.** You are responsible for activity under your account. Use a strong password that you don't use anywhere else, and don't share your login. If you think someone else has access to your account, tell us right away at {{CONTACT_EMAIL}}.

**Usernames.** Don't choose a username that impersonates someone, infringes someone's rights, or is hateful or obscene. We may change or reclaim a username that breaks these Terms.

**Your account is yours alone.** Don't sell, trade, or transfer accounts, and don't create accounts to get around a suspension, a ban, or a limit.

## 5. Your content

> **In short:** What you post stays yours. You give us only the permission we need to run Campfire Online, and you're responsible for what you share.

"Your content" means anything you post or upload, such as messages, direct messages, files, images, voice notes, soundboard clips, custom emoji, profile details, camp names and descriptions, polls, and gatherings.

**You keep ownership.** We don't claim ownership of your content.

**The permission you give us.** You give us a worldwide, non-exclusive, royalty-free license to host, store, copy, transmit, format, and display your content, only as needed to operate, secure, and provide the Service (including making backups and showing link previews) and to enforce these Terms. This license ends when your content is deleted from the Service, except for:

- copies in backups, until those backups expire;
- copies other people kept using the Service's features, for example by saving a message to their Camp Journal or by a moderator exporting a channel; and
- content we must keep to comply with the law or to deal with abuse.

**Other people can use it in the Service.** When you share content in a camp or a direct message, the people who can see it can view it, reply to it, react to it, and save it, using the Service's features.

**Your responsibility.** You confirm that you have the rights to everything you share, and that sharing it doesn't break these Terms or the law. We don't review content before it is posted and we aren't responsible for content other people post, but we may remove content that breaks these Terms (see sections 7 and 14).

**Feedback.** If you send us ideas or suggestions, we may use them freely and without any obligation to you.

## 6. Community rules (acceptable use)

> **In short:** Be decent, keep it legal, protect kids, and don't attack or abuse the Service.

These rules apply everywhere on Campfire Online: camps, direct messages, voice and video, profiles, usernames, camp names, and uploads. A camp can add stricter rules of its own, but it can't relax these.

### 6.1 Respect other people

Don't:

- **Harass or bully** anyone. This includes sustained unwanted contact, pile-ons, and encouraging others to harass someone.
- **Promote hate:** attack or demean people because of their race, ethnicity, national origin, caste, religion, sex, gender identity, sexual orientation, disability, serious illness, or age.
- **Threaten or incite violence**, glorify violent attacks, or support terrorist or violent extremist groups.
- **Encourage suicide or self-harm.**
- **Dox people:** share someone's private information (such as a home address, phone number, private photos, or financial or government ID details) without their permission.
- **Share intimate images of someone without their consent**, including faked or AI-generated images, or threaten to do so.
- **Impersonate** a person, group, or organization, or misrepresent your connection to one, including pretending to be Campfire Online staff.

### 6.2 Child safety: zero tolerance

We have zero tolerance for content or behavior that sexually exploits or endangers children. Don't share, ask for, or link to child sexual abuse material (including drawn, animated, or AI-generated material), sexualize minors in any way, or groom, solicit, or sexually contact anyone under 18.

We remove such material, permanently ban the accounts involved, and report apparent child sexual exploitation to the National Center for Missing & Exploited Children (NCMEC), which works with law enforcement, as US law requires. We may preserve related information for law enforcement.

### 6.3 Sexual and graphic content

Campfire Online is open to teens and has no age-restricted spaces, so sexually explicit content (including pornography) is not allowed anywhere on it. Don't share gory or shocking content that is meant to disturb people.

### 6.4 Keep it legal

Don't use the Service to break the law or to help anyone else break it. For example: selling illegal drugs or weapons, fraud and scams, illegal gambling, or infringing someone else's copyright, trademark, or other rights.

### 6.5 Don't abuse the Service

Don't:

- **Spam:** send unsolicited bulk messages, ads, or friend requests; mass-create accounts, camps, or invites; or fake activity.
- **Spread malware or phishing:** share viruses or other malicious code, or links designed to steal logins or data.
- **Scrape or automate:** use bots, scripts, or crawlers to access the Service or to collect information about its users, unless we have given you written permission.
- **Interfere with the Service:** overload or disrupt it, get around rate limits or upload limits, or use our voice relay (TURN) servers for anything other than Campfire calls.
- **Break in:** access accounts, camps, channels, or data you aren't allowed to see, or probe the Service for weaknesses. Good-faith security research is welcome if you report what you find to us privately (through a private security advisory on the project's GitHub repository or at {{CONTACT_EMAIL}}) and don't harm users or their data.
- **Evade enforcement:** come back with a new account or another workaround after we have suspended or banned you, or rejoin a camp that banned you.

## 7. Camps and moderation

> **In short:** Camp owners and moderators run their own camps. We can step in anywhere on Campfire Online.

**Camp owners and moderators.** Whoever creates a camp owns it and can appoint moderators. Depending on their permissions, they can set the camp's rules, delete messages, kick or ban members, set channels to delete messages automatically after a set time ("leave-no-trace"), export a channel's messages, and delete channels or the whole camp, which deletes the content in them. They are responsible for moderating their camps in line with these Terms. They are not our employees or agents, and we are not responsible for their decisions.

**What we do.** We don't monitor everything people post. We may review content and accounts when they are reported to us, when we need to for safety or security, or when the law requires it. We may remove any content, restrict features, delete camps, or suspend or ban accounts anywhere on Campfire Online if we believe they break these Terms, put other people or us at risk, or must be removed by law. Where it is appropriate and safe, we will tell you what we did and why.

**Appeals.** If you think we got something wrong, email {{CONTACT_EMAIL}} and we will take another look. Decisions that camp moderators make inside their own camps are up to them. If a camp's moderators warn, kick, or ban you after a report, the notice you receive in the app lets you appeal to that camp once, within 14 days; the camp's moderators decide the appeal, and we don't review their decisions.

## 8. Reporting problems

> **In short:** Use Report in the app, or email us about anything urgent.

Use **Report** on a message or on a member of a camp. The report goes to that camp's moderators, who see your reason, your username, and, for a message report, the message as it was when you reported it (we keep that copy as evidence even if the message is deleted later). We can see every message report too, even after the camp's moderators have handled it, and any report a camp's moderators pass on to us. A report that isn't tied to a camp comes only to us. The person you report isn't told who reported them. For anything urgent, especially a threat to someone's safety or anything involving a child, email {{ABUSE_EMAIL}}. If someone is in immediate danger, contact your local emergency services first.

## 9. Copyright and DMCA

> **In short:** If your copyrighted work is on Campfire Online without permission, send us a notice and we'll take it down.

We respond to notices of claimed copyright infringement under the US Digital Millennium Copyright Act (DMCA). Send notices to our designated agent:

- **Designated agent:** {{DMCA_AGENT}}
- **Email:** {{DMCA_EMAIL}}
- **Mail:** {{OPERATOR_NAME}}, {{MAILING_ADDRESS}}

Your notice must include:

1. your physical or electronic signature;
2. identification of the copyrighted work you claim is infringed;
3. identification of the material you claim is infringing, with enough detail for us to find it (for example, a link to the message, or the camp and channel name);
4. your contact information: address, phone number, and email address;
5. a statement that you believe in good faith that the use is not authorized by the copyright owner, its agent, or the law; and
6. a statement that the information in your notice is accurate and, under penalty of perjury, that you are the copyright owner or are authorized to act for the owner.

**Counter-notices.** If your content was removed and you believe that was a mistake or a misidentification, you can send our agent a counter-notice that includes: your physical or electronic signature; identification of the removed material and where it appeared; a statement under penalty of perjury that you believe in good faith the material was removed by mistake or misidentification; and your name, address, and phone number, with a statement that you consent to the jurisdiction of the federal district court for your address (or, if you are outside the United States, any judicial district in which we may be found) and that you will accept service of process from the person who sent the original notice. We may restore the material 10 to 14 business days after we receive a valid counter-notice, unless the person who sent the original notice tells us they have filed a court action.

**Repeat infringers.** We terminate the accounts of repeat infringers in appropriate circumstances.

Sending a notice or counter-notice that you know is false can make you liable for damages.

## 10. Privacy

> **In short:** Our Privacy Policy explains what we collect and why. Messages are not end-to-end encrypted.

Our [Privacy Policy](/privacy) explains how we handle your information. One thing worth knowing up front: messages, direct messages, and files are stored on our servers in a form our systems can read; they are not end-to-end encrypted. Voice and video calls are encrypted, travel directly between participants (or through a relay that can't decrypt them), and are never recorded by us.

## 11. Third-party services

> **In short:** A few features rely on other companies, and their terms apply to those parts.

Some features use services run by other companies. Examples include GIF search (GIPHY), message translation (LibreTranslate), signing in with GitHub or Google, link previews that load images from the linked website, and downloading and updating the Windows app through GitHub. Your use of those services is also subject to their own terms and policies. We are not responsible for third-party services or websites, including websites linked in messages.

## 12. Open source

> **In short:** Campfire's code is free software under the AGPL. That license covers the code; these Terms cover your use of the service we run.

Campfire's source code is published at <https://github.com/LouSputthole/Squatch-Bunker> under the GNU Affero General Public License, version 3 only (AGPL-3.0). These Terms govern your use of Campfire Online, the hosted service we run. They don't govern the source code, and nothing in them limits the rights the AGPL gives you to use, study, change, and share the software. We make the source code of the software we run available as the AGPL requires.

Please don't present another Campfire server as Campfire Online, or suggest that we run or endorse a server we don't.

## 13. It's free (for now)

> **In short:** Campfire Online is free today. If we ever add paid features, we'll tell you first, and you'll never be charged unless you choose to buy something.

Campfire Online is currently free, and nothing in it can be bought. We may offer optional paid features or plans in the future. If we do, we will announce them before they launch, show you the price and the terms that apply before you buy, and never charge you unless you choose to buy.

## 14. Suspension and termination

> **In short:** You can leave anytime. We can suspend or close accounts that break the rules, and we'll give notice if we ever shut down.

**You.** You can stop using Campfire Online at any time. To close your account, use **Delete account** in Settings, under Account. Our Privacy Policy explains what deleting your account removes and what may remain.

**Us.** We may suspend or end your access, or delete your account or content, if you break these Terms, if we need to in order to protect people or the Service, or if the law requires it. Where it is appropriate and safe, we will tell you and explain why. Serious violations, such as anything involving the exploitation of children, lead to an immediate and permanent ban without notice.

**If we shut down.** We may discontinue Campfire Online. If we do, we will try to give at least 30 days' notice so you can save anything you want to keep.

**What continues.** Sections 5 (for content already shared, as described there), 12, and 15 through 20 continue to apply after your account ends.

## 15. Disclaimers

> **In short:** We work hard on Campfire Online, but it comes with no guarantees.

TO THE FULLEST EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, THAT CONTENT WILL BE PRESERVED, OR THAT CALLS WILL CONNECT. WE ARE NOT RESPONSIBLE FOR THE CONTENT OR CONDUCT OF USERS, CAMP OWNERS, MODERATORS, OR THIRD PARTIES.

We are not responsible for delays or failures caused by events beyond our reasonable control, such as natural disasters, pandemics, war, terrorism, riots, government action, labor disputes, power or internet outages, or failures of our hosting or other service providers.

Some places don't allow certain warranties to be excluded, so some of this section may not apply to you.

## 16. Limitation of liability

> **In short:** If something goes wrong, our liability is limited as far as the law allows.

TO THE FULLEST EXTENT PERMITTED BY LAW:

- WE WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF DATA, CONTENT, PROFITS, REVENUE, OR GOODWILL, ARISING OUT OF OR RELATING TO THE SERVICE OR THESE TERMS, EVEN IF WE WERE TOLD THEY WERE POSSIBLE; AND
- OUR TOTAL LIABILITY FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THE SERVICE OR THESE TERMS IS LIMITED TO THE GREATER OF US$100 OR THE AMOUNT YOU PAID US FOR THE SERVICE IN THE 12 MONTHS BEFORE THE CLAIM AROSE.

These limits don't apply to liability that the law does not allow us to limit, such as liability for fraud, or for death or personal injury caused by our negligence. If you are a consumer in the European Economic Area or the United Kingdom, nothing in these Terms limits your mandatory legal rights.

## 17. Indemnity

> **In short:** If your misuse of Campfire Online gets us into legal trouble, you'll cover the cost.

To the extent the law allows, you agree to defend, indemnify, and hold harmless {{OPERATOR_NAME}} and its owners, team members, and agents against third-party claims, and the related losses and reasonable costs (including reasonable legal fees), that arise from your content, your breach of these Terms, or your violation of the law or of someone else's rights. We may take over the defense of a claim at our own cost, and if we do, you will cooperate with us. This section doesn't apply to claims caused by our own wrongdoing.

## 18. Governing law and disputes

> **In short:** Let's try to sort things out informally first. If we can't, the laws and courts of {{GOVERNING_LAW}} apply.

**Talk to us first.** Before you bring a claim, please email {{CONTACT_EMAIL}} describing the problem and what you would like us to do. We will try to resolve it with you informally within 30 days, and we will do the same before bringing a claim against you.

**Governing law.** These Terms, and any dispute about them or about the Service, are governed by the laws of the State of {{GOVERNING_LAW}} and applicable US federal law, without regard to conflict-of-law rules.

**Where disputes are decided.** Disputes will be decided only in the state or federal courts located in {{VENUE}}, and you and we consent to the jurisdiction of those courts. Either of us may still bring a claim in small-claims court if it qualifies, and either of us may ask any court to stop infringement of intellectual property or misuse of the Service.

**Consumers outside the United States.** If you are a consumer who lives in the European Economic Area, the United Kingdom, or another country whose laws give you the right to bring a claim in your local courts or under your local law, nothing in this section takes that right away.

## 19. Changes to these Terms

> **In short:** We'll post updates here with a new effective date, and give you advance notice of important changes.

We may update these Terms from time to time. When we do, we will post the new version on this page with a new effective date. If a change is material, we will post a notice on this page and email registered accounts at least 30 days before it takes effect, unless the change is required by law or is urgently needed for safety or security, in which case it may take effect sooner. If you keep using the Service after a change takes effect, you accept the updated Terms. If you don't agree with them, stop using the Service and delete your account.

## 20. General

> **In short:** The usual legal fine print.

- **Entire agreement.** These Terms, our Privacy Policy, and any additional terms we show you for features you choose to use are the entire agreement between you and us about the Service.
- **Severability.** If any part of these Terms is found to be unenforceable, the rest stays in effect, and that part is enforced as far as the law allows.
- **No waiver.** If we don't enforce a part of these Terms right away, we can still enforce it later.
- **Assignment.** You can't transfer your rights or obligations under these Terms without our written consent. We may transfer ours, for example as part of a merger, acquisition, or sale of assets, or to someone who takes over running the Service.
- **Relationship.** These Terms don't create a partnership, joint venture, employment, or agency relationship between you and us.
- **Electronic notices.** We may send you notices electronically, in the app or to the email address on your account, and those notices meet any legal requirement that notices be in writing.
- **Headings and summaries.** Headings and the "In short" summaries are there for convenience and don't change the meaning of these Terms.
- **Language.** If we provide a translation of these Terms, the English version controls where the law allows.

## 21. Contact

- **Questions about these Terms:** {{CONTACT_EMAIL}}
- **Abuse and safety reports:** {{ABUSE_EMAIL}}
- **Copyright (DMCA) notices:** {{DMCA_EMAIL}}
- **Mail:** {{OPERATOR_NAME}}, {{MAILING_ADDRESS}}
`;
