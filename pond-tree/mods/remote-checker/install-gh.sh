#!/bin/sh
# Installs the GitHub CLI without Homebrew: the official release for this OS and CPU, checked
# against the release's checksums, into ~/.local/bin (no admin rights). Prints the binary's path.
set -eu
case "$(uname -s)" in Darwin) os=macOS ext=zip ;; Linux) os=linux ext=tar.gz ;; *) echo "Unsupported OS: $(uname -s)" >&2; exit 2 ;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=amd64 ;; *) echo "Unsupported CPU: $(uname -m)" >&2; exit 2 ;; esac
# The latest tag from the redirect, so no API rate limit applies.
tag=$(curl -fsSIL -o /dev/null -w '%{url_effective}' https://github.com/cli/cli/releases/latest | sed 's|.*/tag/||')
ver=${tag#v}
[ -n "$ver" ] || { echo "Couldn't find the latest gh release" >&2; exit 1; }
name="gh_${ver}_${os}_${arch}"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
base="https://github.com/cli/cli/releases/download/$tag"
curl -fsSL -o "$tmp/$name.$ext" "$base/$name.$ext"
curl -fsSL -o "$tmp/sums.txt" "$base/gh_${ver}_checksums.txt"
want=$(grep " $name.$ext\$" "$tmp/sums.txt" | cut -d' ' -f1)
have=$(shasum -a 256 "$tmp/$name.$ext" 2>/dev/null | cut -d' ' -f1 || sha256sum "$tmp/$name.$ext" | cut -d' ' -f1)
[ -n "$want" ] && [ "$want" = "$have" ] || { echo "Checksum mismatch for $name.$ext" >&2; exit 1; }
if [ "$ext" = zip ]; then unzip -q "$tmp/$name.$ext" -d "$tmp"; else tar -xzf "$tmp/$name.$ext" -C "$tmp"; fi
mkdir -p "$HOME/.local/bin"
install -m 755 "$tmp/$name/bin/gh" "$HOME/.local/bin/gh"
echo "$HOME/.local/bin/gh"
