# Date on Hash on GitHub PR

Show the committer date beside commit hashes on GitHub pull requests.

Labels include both the age of a recent commit and its local timestamp:

- Less than one hour old: `17 min ago, Oct 27, 11:33`.
- At least one hour and less than 24 hours old: `3 hr ago, Oct 27, 08:00`.
- At least 24 hours old, or dated in the future: `Oct 26, 11:33`.

Minutes and hours are rounded down. Commits less than one minute old show `0 min ago`. The abbreviations `min` and `hr` stay the same for one or more units. A comma separates the relative time from the timestamp. Months use English abbreviations, days have no leading zero, and hours and minutes use two digits in 24-hour time. The label omits the year, seconds, and UTC offset. Hover over it to see the original ISO timestamp.

Labels update once per minute and when you return to the tab. These label updates do not refetch commit data. Timestamps follow your browser's local time zone.

## Load the extension locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository folder that contains `manifest.json`.
5. Reload any GitHub pull request that was already open.

No build, extension account, or GitHub token setup is required. There is no settings page.

## Supported pages

The extension adds labels on `https://github.com/OWNER/REPO/pull/NUMBER` and its subpages. It supports matching commit hash links in Conversation, Commits, and Files views, including links added after the page loads.

The content script is registered for all of `github.com` so it can handle navigation from a non-PR page into a PR without a full page reload. It checks the current URL and adds labels only on PR pages. GitHub Enterprise Server on other domains is not supported.

## Data handling

The extension reads GitHub URLs and page HTML in your browser to find commit hashes and `committedDate` values. If the current page lacks a date, it fetches the PR's commit list and, if necessary, an individual commit page from the same GitHub repository. It uses the committer date, not the author date or push time.

It fetches the full HTML before selecting the needed date, so the received page may include usernames, commit messages, or code. Page information is not sent to a developer backend or analytics service. Requests use the browser's normal GitHub login state; the extension does not independently read or store cookie values, passwords, or access tokens.

The extension keeps its processing cache in tab memory. The cache can survive navigation within GitHub and is discarded on a full page reload or when the page closes. It does not use extension-specific persistent storage or the browsing history API.

Requests are limited to three at a time and time out after 15 seconds. If a date cannot be retrieved, no label is shown. Reload the page to retry.

## Privacy policy

Read the [published privacy policy](https://yuki777.github.io/date-on-hash-on-github-pr/) or its [Markdown source](docs/privacy-policy.md).

## Verification and limitations

Earlier builds were loaded in Chromium and checked against two public PRs in Conversation, Commits, and Files views. Browser checks covered dynamic links, navigation, duplicate prevention, and failed retrieval. The extracted 1.0.7 submission package was checked for the exact compact format, minute/hour/day boundaries, automatic updates, preserved ISO timestamps, and three local time zones. Public PR screenshots were recaptured with the compact labels.

Private repositories and very large PRs have not been tested. GitHub HTML or embedded data changes may require an extension update.

This Manifest V3 extension uses [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) and [same-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests). It requests GitHub site access without additional extension API permissions. It has no external runtime libraries or background service worker.
