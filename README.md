# Papers Feed

My personal research paper reading feed. This system passively tracks which
papers I read (via a browser extension) and publishes an interactive feed
through GitHub Pages.

Live feed: https://soyomarvaldezg.github.io/papers-feed/

## How it works

1. A browser extension monitors my reading on supported paper sites (arXiv,
   OpenReview, and more).
2. Each paper I read is logged as a GitHub issue (used as a simple database).
3. GitHub Actions workflows compile the data and publish it to GitHub Pages.

## Credits

This project is **totally inspired by** and based on
[dmarx/papers-feed-template](https://github.com/dmarx/papers-feed-template)
by [@DigThatData](https://bsky.app/profile/digthatdata.bsky.social).

## Setup

Follow the setup guide in the original template:
https://github.com/dmarx/papers-feed-template
