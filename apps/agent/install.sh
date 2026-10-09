#!/usr/bin/env sh
set -eu

# Neko Agent Install Script
# Features:
#   - Detects existing nekoagent installation
#   - Uses local nekoagent if available
#   - Supports adding multiple backend instances

VERSION="0.2.0"

require_env() {
	key="$1"
	eval "val=\${$key:-}"
	if [ -z "$val" ]; then
		echo "[neko-agent] error: env $key is required" >&2
		exit 1
	fi
}

show_intro() {
	cat <<'EOF'
╔════════════════════════════════════════════════════════════╗
║                    Neko Master Agent                      ║
╚════════════════════════════════════════════════════════════╝

Neko Master is a centralized traffic analytics panel.
Agent runs near your local gateway and reports data securely to the panel.

Project:
  https://github.com/foru17/neko-master

Agent docs:
  https://github.com/foru17/neko-master/tree/main/docs/agent

EOF
}

detect_existing_install() {
	# Check for nekoagent in common locations
	if command -v nekoagent >/dev/null 2>&1; then
		echo "$(command -v nekoagent)"
		return 0
	fi

	# Check default install locations
	for path in "$HOME/.local/bin/nekoagent" "/usr/local/bin/nekoagent"; do
		if [ -x "$path" ]; then
			echo "$path"
			return 0
		fi
	done

	# Not found
	return 1
}

wget_with_retries() (
	# BusyBox wget may not support --tries; keep its fallback bounded too.
	if wget --help 2>&1 | grep -q -- --tries; then
		wget --timeout=120 --tries=3 "$@"
		return $?
	fi
	attempt=0
	while [ "$attempt" -lt 3 ]; do
		if wget --timeout=120 "$@"; then
			return 0
		else
			download_status=$?
		fi
		attempt=$((attempt + 1))
	done
	return "$download_status"
)

download_file() {
	url="$1"
	output="$2"
	# Propagate the downloader's exit status (a plain `return 0` would mask
	# failures when callers invoke this inside a condition under `set -e`).
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL --connect-timeout 10 --max-time 120 --retry 3 --retry-delay 2 "$url" -o "$output"
		return $?
	fi
	if command -v wget >/dev/null 2>&1; then
		wget_with_retries -qO "$output" "$url"
		return $?
	fi
	echo "[neko-agent] error: curl or wget is required" >&2
	exit 1
}

normalize_os() {
	raw="$(uname -s | tr 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' 'abcdefghijklmnopqrstuvwxyz')"
	case "$raw" in
	linux) echo "linux" ;;
	darwin) echo "darwin" ;;
	*)
		echo "[neko-agent] error: unsupported OS: $raw" >&2
		exit 1
		;;
	esac
}

normalize_arch() {
	raw="$(uname -m | tr 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' 'abcdefghijklmnopqrstuvwxyz')"
	case "$raw" in
	x86_64 | amd64) echo "amd64" ;;
	aarch64 | arm64) echo "arm64" ;;
	armv7l | armv7 | armhf) echo "armv7" ;;
	mips) echo "mips" ;;
	mipsle) echo "mipsle" ;;
	*)
		echo "[neko-agent] error: unsupported architecture: $raw" >&2
		echo "[neko-agent] hint: set NEKO_PACKAGE_URL manually if your target is exotic" >&2
		exit 1
		;;
	esac
}

# Query GitHub releases API for the latest agent tag (e.g. "agent-v0.2.0").
# Reports HTTP/download errors on stderr and returns non-zero on failure.
#
# The repo publishes BOTH main-app (v*) and agent (agent-v*) releases into the
# same namespace, and either may be marked "latest". So we must NOT use the
# releases/latest endpoint — it can resolve to a main-app release that carries
# no agent binaries. Instead list recent releases and pick the newest agent-v*.
get_latest_remote_tag() (
	repo="${1:-foru17/neko-master}"
	api_url="https://api.github.com/repos/${repo}/releases?per_page=100"
	token="${GITHUB_TOKEN:-${GITHUB_PAT:-}}"
	# Isolate temporary files, credentials and traps from the install/upgrade flow.
	umask 077
	api_tmp_dir="$(mktemp -d)" || return 1
	trap 'rm -rf "$api_tmp_dir"' 0
	trap 'exit 1' 1 2 15
	request_status=0
	if command -v curl >/dev/null 2>&1; then
		set -- -fsSL --connect-timeout 10 --max-time 120 --retry 3 --retry-delay 2
		if [ -n "$token" ]; then
			set -- "$@" -H "Authorization: Bearer $token"
		fi
		http_code="$(curl "$@" -o "$api_tmp_dir/body" -w '%{http_code}' "$api_url" 2>/dev/null)" || request_status=$?
	elif command -v wget >/dev/null 2>&1; then
		set -- -S -O "$api_tmp_dir/body"
		if [ -n "$token" ]; then
			set -- "$@" --header="Authorization: Bearer $token"
		fi
		wget_with_retries "$@" "$api_url" 2>"$api_tmp_dir/headers" || request_status=$?
		http_code="$(awk '$1 ~ /^HTTP\// && $2 ~ /^[0-9][0-9][0-9]$/ {code=$2} END {print code}' "$api_tmp_dir/headers")"
	else
		echo "[neko-agent] error: curl or wget is required" >&2
		return 1
	fi

	case "$http_code" in
		401) api_error="GitHub token rejected (401)" ;;
		403|429) api_error="GitHub API rate limit or forbidden (HTTP $http_code); set GITHUB_TOKEN" ;;
		2??) api_error="" ;;
		*) api_error="GitHub API request failed (HTTP ${http_code:-unknown})" ;;
	esac
	if [ -n "$api_error" ]; then
		echo "[neko-agent] error: $api_error" >&2
		return 1
	fi
	if [ "$request_status" -ne 0 ]; then
		echo "[neko-agent] error: GitHub API download failed (HTTP $http_code; downloader exit $request_status)" >&2
		return 1
	fi
	tag="$(awk -F'"' '/"tag_name"/{print $4}' "$api_tmp_dir/body" | grep '^agent-v' | head -1)"
	if [ -z "$tag" ]; then
		echo "[neko-agent] error: no agent-v* release found in GitHub API response" >&2
		return 1
	fi
	printf '%s\n' "$tag"
)

compute_sha256() {
	file="$1"
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$file" | awk '{print $1}'
		return 0
	fi
	if command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$file" | awk '{print $1}'
		return 0
	fi
	if command -v openssl >/dev/null 2>&1; then
		openssl dgst -sha256 "$file" | awk '{print $2}'
		return 0
	fi
	echo ""
}

# Use local nekoagent to add instance
use_local_agent() {
	nekoagent_path="$1"
	instance_name="${NEKO_INSTANCE_NAME:-backend-${NEKO_BACKEND_ID}}"

	echo "[neko-agent] detected existing installation: $nekoagent_path"
	echo "[neko-agent] using local nekoagent to add instance..."

	# Build add command
	set -- \
		"$nekoagent_path" add "$instance_name" \
		--server-url "$NEKO_SERVER" \
		--backend-id "$NEKO_BACKEND_ID" \
		--backend-token "$NEKO_BACKEND_TOKEN" \
		--gateway-type "$NEKO_GATEWAY_TYPE" \
		--gateway-url "$NEKO_GATEWAY_URL"

	if [ -n "${NEKO_GATEWAY_TOKEN:-}" ]; then
		set -- "$@" --gateway-token "$NEKO_GATEWAY_TOKEN"
	fi

	if [ "${NEKO_AUTO_START:-true}" != "true" ]; then
		set -- "$@" --no-start
	fi

	# Execute
	"$@"

	if [ "${NEKO_AUTO_START:-true}" = "true" ]; then
		if "$nekoagent_path" enable-autostart "$instance_name"; then
			echo "[neko-agent] boot autostart enabled for: $instance_name"
		else
			echo "[neko-agent] warning: failed to enable boot autostart (instance still configured)"
			echo "[neko-agent] hint: run manually: $nekoagent_path enable-autostart $instance_name"
		fi
	fi
}

show_plan() {
	token_mode="not set"
	if [ -n "${NEKO_GATEWAY_TOKEN:-}" ]; then
		token_mode="provided"
	fi

	cat <<EOF
[neko-agent] install plan:
  target:            ${os}/${arch}
  version:           ${NEKO_AGENT_VERSION}
  backend id:        ${NEKO_BACKEND_ID}
  instance:          ${NEKO_INSTANCE_NAME}
  gateway type:      ${NEKO_GATEWAY_TYPE}
  gateway url:       ${NEKO_GATEWAY_URL}
  gateway token:     ${token_mode}
  install dir:       ${NEKO_INSTALL_DIR}
  auto start:        ${NEKO_AUTO_START}
EOF
}

# Main installation flow
main() {
	require_env "NEKO_SERVER"
	require_env "NEKO_BACKEND_ID"
	require_env "NEKO_BACKEND_TOKEN"
	require_env "NEKO_GATEWAY_URL"

	show_intro

	# Environment defaults
	NEKO_GATEWAY_TYPE="${NEKO_GATEWAY_TYPE:-clash}"
	NEKO_GATEWAY_TOKEN="${NEKO_GATEWAY_TOKEN:-}"
	NEKO_AGENT_REPO="${NEKO_AGENT_REPO:-foru17/neko-master}"
	NEKO_AGENT_VERSION="${NEKO_AGENT_VERSION:-latest}"
	NEKO_PACKAGE_URL="${NEKO_PACKAGE_URL:-}"
	NEKO_CHECKSUMS_URL="${NEKO_CHECKSUMS_URL:-}"
	NEKO_CLI_URL="${NEKO_CLI_URL:-}"
	# NEKO_AGENT_REF: override the git branch/ref used to download the nekoagent manager script.
	# Useful for testing unreleased branches (e.g. NEKO_AGENT_REF=refactor/clickhouse).
	# When unset: uses "main" for latest, or the version tag for pinned versions.
	NEKO_AGENT_REF="${NEKO_AGENT_REF:-}"
	NEKO_INSTALL_DIR="${NEKO_INSTALL_DIR:-$HOME/.local/bin}"
	NEKO_BIN_LINK_MODE="${NEKO_BIN_LINK_MODE:-auto}"
	NEKO_LINK_DIR="${NEKO_LINK_DIR:-/usr/local/bin}"
	NEKO_LOG="${NEKO_LOG:-true}"
	NEKO_AUTO_START="${NEKO_AUTO_START:-true}"
	NEKO_INSTANCE_NAME="${NEKO_INSTANCE_NAME:-backend-${NEKO_BACKEND_ID}}"

	os="$(normalize_os)"
	arch="$(normalize_arch)"

	# Check if nekoagent is already installed
	existing_agent="$(detect_existing_install || true)"

	# If already installed, check whether the binary is up-to-date before deciding
	if [ -n "$existing_agent" ] && [ "${NEKO_FORCE_INSTALL:-false}" != "true" ]; then
		# Locate the neko-agent binary (same dir as nekoagent, or /usr/local/bin fallback)
		existing_bin="$(dirname "$existing_agent")/neko-agent"
		[ -x "$existing_bin" ] || existing_bin="/usr/local/bin/neko-agent"

		local_version=""
		if [ -x "$existing_bin" ]; then
			local_version="$("$existing_bin" --version 2>/dev/null | head -1 || true)"
		fi

		# Determine target plain version (strip "agent-v" prefix)
		if [ "$NEKO_AGENT_VERSION" = "latest" ]; then
			resolved_tag="$(get_latest_remote_tag "$NEKO_AGENT_REPO")"
			remote_tag="$resolved_tag"
			target_version="${remote_tag#agent-v}"
		else
			target_version="${NEKO_AGENT_VERSION#agent-v}"
			target_version="${target_version#v}"
		fi

		# If versions match, skip download and just add the instance
		if [ -n "$local_version" ] && [ -n "$target_version" ] && [ "$local_version" = "$target_version" ]; then
			echo "[neko-agent] binary already at $local_version, skipping download"
			use_local_agent "$existing_agent"
			exit 0
		fi

		if [ -n "$local_version" ]; then
			echo "[neko-agent] binary update: $local_version -> ${target_version:-latest}"
		else
			echo "[neko-agent] binary not found or version unknown, downloading..."
		fi
		# Fall through to full download/install, then re-use existing nekoagent to add instance
	fi

	# Full installation needed
	show_plan

	if [ "$NEKO_AGENT_VERSION" = "latest" ]; then
		# Resolve "latest" to a concrete agent-v* tag. releases/latest/download is
		# unsafe here: it points at whatever release GitHub marks latest, which may
		# be a main-app v* release with no agent binaries (→ 404).
		resolved_tag="${resolved_tag:-$(get_latest_remote_tag "$NEKO_AGENT_REPO")}"
		if [ -z "$resolved_tag" ]; then
			echo "[neko-agent] error: could not determine latest agent version from GitHub API" >&2
			echo "[neko-agent] hint: check network access or pin a version: NEKO_AGENT_VERSION=agent-vX.Y.Z" >&2
			exit 1
		fi
		release_path="releases/download/${resolved_tag}"
		asset="neko-agent_${os}_${arch}.tar.gz"
	else
		release_path="releases/download/${NEKO_AGENT_VERSION}"
		asset="neko-agent_${NEKO_AGENT_VERSION}_${os}_${arch}.tar.gz"
	fi

	checksums_asset="checksums.txt"

	if [ -n "$NEKO_PACKAGE_URL" ]; then
		package_url="$NEKO_PACKAGE_URL"
	else
		package_url="https://github.com/${NEKO_AGENT_REPO}/${release_path}/${asset}"
	fi

	if [ -n "$NEKO_CHECKSUMS_URL" ]; then
		checksums_url="$NEKO_CHECKSUMS_URL"
	else
		checksums_url="https://github.com/${NEKO_AGENT_REPO}/${release_path}/${checksums_asset}"
	fi

	if [ -n "$NEKO_CLI_URL" ]; then
		cli_url="$NEKO_CLI_URL"
	else
		if [ -n "$NEKO_AGENT_REF" ]; then
			cli_ref="$NEKO_AGENT_REF"
		elif [ "$NEKO_AGENT_VERSION" = "latest" ]; then
			cli_ref="main"
		else
			cli_ref="$NEKO_AGENT_VERSION"
		fi
		cli_url="https://raw.githubusercontent.com/${NEKO_AGENT_REPO}/${cli_ref}/apps/agent/nekoagent"
	fi

	tmp_dir="${TMPDIR:-/tmp}/neko-agent.$$"
	mkdir -p "$tmp_dir"
	trap 'rm -rf "$tmp_dir"' EXIT INT TERM

	archive_path="$tmp_dir/neko-agent.tar.gz"
	checksums_path="$tmp_dir/checksums.txt"
	cli_path="$tmp_dir/nekoagent"

	echo "[neko-agent] downloading package: $package_url"
	download_file "$package_url" "$archive_path"

	if [ -z "$NEKO_PACKAGE_URL" ]; then
		echo "[neko-agent] downloading checksums: $checksums_url"
		download_file "$checksums_url" "$checksums_path"

		expected_hash="$(awk '$2 == "'"$asset"'" {print $1}' "$checksums_path" | head -n 1)"
		if [ -z "$expected_hash" ]; then
			echo "[neko-agent] error: cannot find checksum for $asset" >&2
			exit 1
		fi

		actual_hash="$(compute_sha256 "$archive_path")"
		if [ -z "$actual_hash" ]; then
			echo "[neko-agent] error: missing sha256 tooling (sha256sum/shasum/openssl)" >&2
			exit 1
		fi

		if [ "$expected_hash" != "$actual_hash" ]; then
			echo "[neko-agent] error: checksum mismatch for $asset" >&2
			echo "[neko-agent] expected: $expected_hash" >&2
			echo "[neko-agent] actual:   $actual_hash" >&2
			exit 1
		fi
	fi

	mkdir -p "$tmp_dir/extract"
	tar -xzf "$archive_path" -C "$tmp_dir/extract"

	binary_source="$tmp_dir/extract/neko-agent"
	if [ ! -f "$binary_source" ]; then
		echo "[neko-agent] error: extracted archive does not contain neko-agent" >&2
		exit 1
	fi

	chmod +x "$binary_source"
	mkdir -p "$NEKO_INSTALL_DIR"
	install_target="$NEKO_INSTALL_DIR/neko-agent"
	mv "$binary_source" "$install_target"
	chmod +x "$install_target"

	echo "[neko-agent] downloading manager cli: $cli_url"
	download_file "$cli_url" "$cli_path"
	chmod +x "$cli_path"
	cli_target="$NEKO_INSTALL_DIR/nekoagent"
	mv "$cli_path" "$cli_target"
	chmod +x "$cli_target"

	linked_to_path="false"
	if [ "$NEKO_BIN_LINK_MODE" != "false" ]; then
		can_link="false"
		if [ "$NEKO_BIN_LINK_MODE" = "true" ]; then
			can_link="true"
		elif [ -d "$NEKO_LINK_DIR" ] && [ -w "$NEKO_LINK_DIR" ]; then
			can_link="true"
		fi

		if [ "$can_link" = "true" ]; then
			if mkdir -p "$NEKO_LINK_DIR" 2>/dev/null; then
				if ln -sf "$install_target" "$NEKO_LINK_DIR/neko-agent" 2>/dev/null &&
					ln -sf "$cli_target" "$NEKO_LINK_DIR/nekoagent" 2>/dev/null; then
					linked_to_path="true"
					echo "[neko-agent] linked binaries into: $NEKO_LINK_DIR"
				fi
			fi
		fi
	fi

	if [ "$linked_to_path" = "false" ] && ! echo ":$PATH:" | grep -q ":$NEKO_INSTALL_DIR:"; then
		echo "[neko-agent] warning: $NEKO_INSTALL_DIR is not in PATH"
		echo "[neko-agent] hint: use full path: $cli_target status $NEKO_INSTANCE_NAME"
		echo "[neko-agent] hint: add PATH in shell profile: export PATH=\"$NEKO_INSTALL_DIR:\$PATH\""
	fi

	# Use the newly installed nekoagent to add instance
	set -- add "$NEKO_INSTANCE_NAME" \
		--server-url "$NEKO_SERVER" \
		--backend-id "$NEKO_BACKEND_ID" \
		--backend-token "$NEKO_BACKEND_TOKEN" \
		--gateway-type "$NEKO_GATEWAY_TYPE" \
		--gateway-url "$NEKO_GATEWAY_URL"
	if [ -n "$NEKO_GATEWAY_TOKEN" ]; then
		set -- "$@" --gateway-token "$NEKO_GATEWAY_TOKEN"
	fi
	if [ "$NEKO_AUTO_START" != "true" ]; then
		set -- "$@" --no-start
	fi
	"$cli_target" "$@"

	if [ "$NEKO_AUTO_START" = "true" ]; then
		if "$cli_target" enable-autostart "$NEKO_INSTANCE_NAME"; then
			echo "[neko-agent] boot autostart enabled for: $NEKO_INSTANCE_NAME"
		else
			echo "[neko-agent] warning: failed to enable boot autostart (instance still configured)"
			echo "[neko-agent] hint: run manually: $cli_target enable-autostart $NEKO_INSTANCE_NAME"
		fi
	fi

	echo "[neko-agent] installed to: $install_target"
	echo "[neko-agent] management cli: $cli_target"
	echo "[neko-agent] configured instance: $NEKO_INSTANCE_NAME"
	echo "[neko-agent] common commands:"
	echo "  nekoagent list"
	echo "  nekoagent start $NEKO_INSTANCE_NAME"
	echo "  nekoagent stop $NEKO_INSTANCE_NAME"
	echo "  nekoagent status $NEKO_INSTANCE_NAME"
	echo "  nekoagent logs $NEKO_INSTANCE_NAME"
	echo "  nekoagent upgrade"
	echo "  nekoagent remove $NEKO_INSTANCE_NAME"
}

main "$@"
