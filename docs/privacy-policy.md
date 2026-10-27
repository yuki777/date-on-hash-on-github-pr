# Date on Hash on GitHub PR Privacy Policy

Last updated: October 27, 2026

## Scope and purpose

This policy applies to the Chrome extension "Date on Hash on GitHub PR". The extension displays commit timestamps beside commit hashes on GitHub pull request pages.

## Information processed in your browser

To display timestamps, the extension processes the current GitHub URL, repository owner and name, pull request number, commit hashes, and committer timestamps in your browser.

When a timestamp is not available on the current page, the extension retrieves HTML from GitHub's pull request commit list or an individual commit page. It reads the HTML before selecting the required timestamp, so the retrieved content may include GitHub usernames, commit messages, or code. The extension does not send this information to developer servers.

The extension does not use an API to retrieve or save a list of your past browsing history. It uses the current GitHub URL to identify the relevant pull request and commits.

## Network requests and sign-in state

Additional requests needed to obtain timestamps go to GitHub over HTTPS. These requests may use your browser's normal GitHub sign-in state.

The extension does not independently read or store cookie values, passwords, or GitHub access tokens. GitHub's own handling of information associated with these requests is governed by GitHub's privacy policy.

## Storage and retention

The extension keeps its working cache in the tab's memory. It may reuse that cache during navigation within GitHub. Reloading or closing the page discards the previous page's working cache. The extension does not use persistent extension storage.

Caches or network logs that your browser or GitHub normally maintains are separate from the extension's working cache.

## Use and sharing

Information is used only to retrieve, display, and update commit timestamps. The extension does not send it to developer servers, advertising services, or analytics services. It does not sell the information or use it for advertising, creditworthiness, or lending decisions.

The extension's use of information adheres to the [Chrome Web Store User Data Policy, including the Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use).

## Stopping use

You can disable or remove the extension in Chrome's extension management page. After disabling or removing it, reload or close GitHub tabs to end any running content scripts and their working caches.

## Contact

For questions about this policy, [open an issue in the project repository](https://github.com/yuki777/date-on-hash-on-github-pr/issues).

## Changes

This policy will be updated if the extension's features or information handling change.

## Related service

- [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)
