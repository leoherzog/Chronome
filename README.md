# Chronome

A GNOME Shell extension that displays your upcoming calendar meetings and agenda for the day. Inspired by [meetingbar](https://meetingbar.app/).

## Features

- **Real-time countdown** to your next meeting, updated every second
- **Clickable video conference links** — Join Zoom, Teams, Meet, Webex, and 40+ other services with one click
- **Today's agenda** in a dropdown menu with color-coded calendar indicators
- **Smart event handling** — Correctly handles recurring events, rescheduled instances, and multi-calendar deduplication
- **Flexible filtering** — Show or hide all-day events, declined events, tentative events, and past events
- **Calendar selection** — Choose which calendars to display from all of your connected accounts
- **Customizable appearance** — 12/24 hour time format, configurable title length, optional calendar colors

## Installation

### From extensions.gnome.org (Recommended)

Visit [extensions.gnome.org](https://extensions.gnome.org/) and search for "Chronome", or install directly from the [extension page](https://extensions.gnome.org/extension/chronome/).

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/leoherzog/Chronome.git

# Copy to GNOME Shell extensions directory
cp -r Chronome ~/.local/share/gnome-shell/extensions/chronome@herzog.tech/

# Compile the settings schema
glib-compile-schemas ~/.local/share/gnome-shell/extensions/chronome@herzog.tech/schemas/

# Enable the extension
gnome-extensions enable chronome@herzog.tech
```

On X11, restart GNOME Shell with Alt+F2 → `r` → Enter. On Wayland, log out and back in.

## Requirements

- GNOME Shell 45, 46, 47, 48, or 49
- Evolution Data Server (typically pre-installed on GNOME desktops)
- GNOME Online Accounts (optional, for cloud calendar sync)

## Configuration

Open the extension preferences via GNOME Extensions app or:

```bash
gnome-extensions prefs chronome@herzog.tech
```

### Settings

| Setting | Description |
|---------|-------------|
| Real-time Countdown | Update the countdown every second |
| Show Current Meeting | Display ongoing meetings instead of only upcoming |
| Event Title Length | Maximum characters for event titles in the panel |
| Time Format | 12-hour or 24-hour time display |
| Panel Icon | Calendar icon, meeting type icon, or none |
| Calendar Colors | Show colored borders matching your calendar colors |
| Event Types | Toggle all-day, regular, declined, and tentative events |
| Show Past Events | Include events that have already ended in the menu |
| Enabled Calendars | Select which calendars to display |

## Supported Video Conferencing Services

Chronome detects video conference links in event locations and descriptions. Supported services include:

Zoom, Microsoft Teams, Google Meet, Webex, Jitsi, GoToMeeting, BlueJeans, Whereby, Around, Gather, Discord, Slack, Facetime, Amazon Chime, RingCentral, Livestorm, Vowel, Zhumu, Lark, Feishu, Voov, Teambition, Welink, Skype, Pop, Chorus, Gong, PhoneBurner, Demodesk, Join.me, and many more.

## License

The MIT License (MIT)

Copyright © 2026 Leo Herzog

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## About Me

<a href="https://herzog.tech/" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://herzog.tech/signature/link-light.svg.png">
    <source media="(prefers-color-scheme: light)" srcset="https://herzog.tech/signature/link.svg.png">
    <img src="https://herzog.tech/signature/link.svg.png" width="32px">
  </picture>
</a>
<a href="https://mastodon.social/@herzog" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://herzog.tech/signature/mastodon-light.svg.png">
    <source media="(prefers-color-scheme: light)" srcset="https://herzog.tech/signature/mastodon.svg.png">
    <img src="https://herzog.tech/signature/mastodon.svg.png" width="32px">
  </picture>
</a>
<a href="https://github.com/leoherzog" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://herzog.tech/signature/github-light.svg.png">
    <source media="(prefers-color-scheme: light)" srcset="https://herzog.tech/signature/github.svg.png">
    <img src="https://herzog.tech/signature/github.svg.png" width="32px">
  </picture>
</a>
<a href="https://keybase.io/leoherzog" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://herzog.tech/signature/keybase-light.svg.png">
    <source media="(prefers-color-scheme: light)" srcset="https://herzog.tech/signature/keybase.svg.png">
    <img src="https://herzog.tech/signature/keybase.svg.png" width="32px">
  </picture>
</a>
<a href="https://www.linkedin.com/in/leoherzog" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://herzog.tech/signature/linkedin-light.svg.png">
    <source media="(prefers-color-scheme: light)" srcset="https://herzog.tech/signature/linkedin.svg.png">
    <img src="https://herzog.tech/signature/linkedin.svg.png" width="32px">
  </picture>
</a>
<a href="https://hope.edu/directory/people/herzog-leo/" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://herzog.tech/signature/anchor-light.svg.png">
    <source media="(prefers-color-scheme: light)" srcset="https://herzog.tech/signature/anchor.svg.png">
    <img src="https://herzog.tech/signature/anchor.svg.png" width="32px">
  </picture>
</a>
<br />
<a href="https://herzog.tech/$" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://herzog.tech/signature/mug-tea-saucer-solid-light.svg.png">
    <source media="(prefers-color-scheme: light)" srcset="https://herzog.tech/signature/mug-tea-saucer-solid.svg.png">
    <img src="https://herzog.tech/signature/mug-tea-saucer-solid.svg.png" alt="Buy Me A Tea" width="32px">
  </picture>
  Found this helpful? Buy me a tea!
</a>
