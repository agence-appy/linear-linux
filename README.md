<p align="center">
<img alt="GH-rel ver" src="icon.png" width="100px">
<h1 align="center">Linear for linux</h1>

<p align="center">
A linux port of <a href="https://linear.app/">linear.app</a>
</p>

<p align="center">
<img alt="GH-rel ver" src="https://img.shields.io/github/v/release/kleo-dev/linear-linux?color=%23f5304c">
</p>

# Linear Linux

A maintained fork of Linear Linux. (`selimaj-dev/linear-linux`)

# Install
Requires `sudo` (for sandbox helper, desktop entry, and icons).

Download the latest `.deb` package from the Releases page.

```bash
sudo apt install ./linear-linux-x.y.z-amd64.deb
```

Remove:

```bash
sudo apt remove linear-linux
```

Development:
- `git clone git@github.com:selimaj-dev/linear-linux.git`
- `cd linear-linux`
- `npm install`
- `npm start` launches Electron with sandbox disabled for local runs (packaged builds use the proper setuid helper).
- `npm run build` produces an AppImage that bundles the Linear brand assets for the desktop icon.

# Having an issue?
Describe your issue [here](https://github.com/agence-appy/linear-linux/issues)
