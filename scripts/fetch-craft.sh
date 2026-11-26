#!/bin/sh
# Downloads the static web builds of WordCraft, GridCraft and PdfCraft from their GitHub
# releases into ui/craft/<app>/ and checks each zip against the release's SHA256SUMS.txt.
#
#   scripts/fetch-craft.sh <dest-dir> [wordcraft=<tag>] [gridcraft=<tag>] [pdfcraft=<tag>]
#
# Without a tag the latest release is used. Pin tags (e.g. wordcraft=v0.14.0) for builds that
# must be reproducible. Runs in the image build, never at runtime.
set -eu

DEST=${1:?destination directory}
shift || true
API=https://api.github.com/repos/storytold
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

tag_for() {
	for pin in "$@"; do
		case "$pin" in "$APP="*) echo "${pin#*=}"; return ;; esac
	done
	echo latest
}

for APP in wordcraft gridcraft pdfcraft; do
	TAG=$(tag_for "$@")
	if [ "$TAG" = latest ]; then URL="$API/$APP/releases/latest"; else URL="$API/$APP/releases/tags/$TAG"; fi
	curl -fsSL ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} "$URL" > "$WORK/$APP.json"
	ZIP_URL=$(grep -o "\"browser_download_url\": *\"[^\"]*/$APP-web-[^\"]*\.zip\"" "$WORK/$APP.json" | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
	SUMS_URL=$(grep -o "\"browser_download_url\": *\"[^\"]*/SHA256SUMS.txt\"" "$WORK/$APP.json" | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
	[ -n "$ZIP_URL" ] || { echo "no $APP-web-*.zip in release $TAG" >&2; exit 1; }
	[ -n "$SUMS_URL" ] || { echo "no SHA256SUMS.txt in $APP release $TAG" >&2; exit 1; }
	ZIP=$(basename "$ZIP_URL")
	curl -fsSL -o "$WORK/$ZIP" "$ZIP_URL"
	curl -fsSL -o "$WORK/$APP.sums" "$SUMS_URL"
	# Exact name match (also for "*name" binary-mode lines); no line means no check, so fail.
	awk -v f="$ZIP" '{n=$2; sub(/^\*/, "", n); if (n == f) print $1 "  " n}' "$WORK/$APP.sums" > "$WORK/$APP.check"
	[ -s "$WORK/$APP.check" ] || { echo "$ZIP is not listed in SHA256SUMS.txt" >&2; exit 1; }
	(cd "$WORK" && sha256sum -c "$APP.check")
	mkdir -p "$WORK/$APP" "$DEST/$APP"
	unzip -q "$WORK/$ZIP" -d "$WORK/$APP"
	# The zip holds the site in <app>-web-<version>/.
	SITE=$(dirname "$(find "$WORK/$APP" -name index.html | head -1)")
	cp -R "$SITE"/. "$DEST/$APP"/
	rm -f "$DEST/$APP/_headers" "$DEST/$APP/.htaccess"
	echo "$APP $(basename "$SITE")" >> "$DEST/VERSIONS.txt"
done
cat "$DEST/VERSIONS.txt"
