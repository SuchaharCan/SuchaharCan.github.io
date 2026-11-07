#!/usr/bin/env zsh
# ============================================================================
#  github_proxy.zsh —— GitHub 国内加速开关（zsh 交互式环境）
#
#  作用：把在 zsh 里发出的 github 相关请求自动改写到国内加速镜像；
#        关闭后立刻恢复直连。默认「开启」。
#
#  用法（github_proxy help 可随时查看）：
#    github_proxy            # 看状态
#    github_proxy on         # 开启（默认状态）
#    github_proxy off        # 关闭，全部直连
#    github_proxy toggle     # 切换
#    github_proxy test       # 实测镜像 vs 直连速度
#    github_proxy url <URL>  # 只看改写结果，方便排查
#    github_proxy brew       # 看 Homebrew 接管状态
#    github_proxy debug on   # 记录包装器实际请求的地址（排查用）
#
#  覆盖范围（只在交互式 zsh 里生效，且不能用 `command xxx` / 绝对路径调用）：
#    ✅ git clone / fetch / pull / ls-remote / submodule / archive
#    ✅ git push —— 完全不受影响：你自己的 pushInsteadOf 规则会把 https 推送
#       改写成 SSH，镜像只做只读加速，绝不会碰到写操作
#    ✅ curl / wget 参数里出现的 github.com、raw.githubusercontent.com、
#       codeload.github.com、gist.github.com、objects.githubusercontent.com
#    ✅ Homebrew —— 用 HOMEBREW_CURL_PATH / HOMEBREW_GIT_PATH 指向本脚本生成的
#       包装器来接管。USTC 镜像只管 API / bottles / 两个核心仓库；brew 升级时对
#       github.com、codeload.github.com、raw.githubusercontent.com 的直连
#       （cask 的 app 包、formula 的源码包、tap 的 formula 定义）由这里加速
#    ❌ 程序自身发起的其它请求：npm / pip / go、VS Code、浏览器、focr 等
#       这些不经过 zsh 也不经过 brew，函数无法接管（focr 用 --manifest 方案解决）
#    ❌ gh CLI：走 api.github.com 且自带客户端，只能用 HTTPS_PROXY
#    ❌ SSH 形式（git@github.com:…）：保持直连，国内一般可用；
#       若不通，可在 ~/.ssh/config 里改用 ssh.github.com:443
#
#  依赖：git / curl（macOS 自带或 Homebrew 安装均可）
#  自定义镜像：export GITHUB_PROXY_MIRROR="https://你的镜像/"
#  只想关掉 Homebrew 接管（保留 git/curl 接管）：export GITHUB_PROXY_BREW_ON=0
# ============================================================================

# ---------------------------------------------------------------------------
# 配置区（可用环境变量覆盖）
# ---------------------------------------------------------------------------
: ${GITHUB_PROXY_MIRROR:=https://gh-proxy.com/}   # 末尾斜杠必须有
typeset -g GITHUB_PROXY_MIRROR

# 命中这些域名就改写
typeset -ga GITHUB_PROXY_HOSTS=(
  github.com
  www.github.com
  raw.githubusercontent.com
  codeload.github.com
  gist.github.com
  objects.githubusercontent.com
  api.github.com
)

# 开关状态持久化位置（默认开启，只有显式 off 才写文件）
typeset -g GITHUB_PROXY_STATE="${XDG_STATE_HOME:-$HOME/.local/state}/github-proxy/state"

# ---- Homebrew 接管（curl / git 包装器由本脚本生成，固定在状态目录里）----
typeset -g GITHUB_PROXY_STATE_DIR="${GITHUB_PROXY_STATE:h}"
typeset -g GITHUB_PROXY_BIN="${GITHUB_PROXY_STATE_DIR}/bin"
typeset -g GITHUB_PROXY_BREW_CURL="${GITHUB_PROXY_BIN}/brew-curl"
typeset -g GITHUB_PROXY_BREW_GIT="${GITHUB_PROXY_BIN}/brew-git"
typeset -g GITHUB_PROXY_DEBUG_MARKER="${GITHUB_PROXY_STATE_DIR}/debug"
typeset -g GITHUB_PROXY_BREW_LOG="${GITHUB_PROXY_STATE_DIR}/brew.log"
# brew 位置：优先用环境变量，缺失时按常见安装路径自动探测
# （Apple Silicon: /opt/homebrew；Intel Mac: /usr/local；Linuxbrew: ~/.linuxbrew）
typeset -g GITHUB_PROXY_PREFIX="${HOMEBREW_PREFIX:-}"
if [[ -z "$GITHUB_PROXY_PREFIX" ]]; then
  typeset _gp_p
  for _gp_p in /opt/homebrew /usr/local /home/linuxbrew/.linuxbrew "$HOME/.linuxbrew"; do
    if [[ -x "$_gp_p/bin/brew" ]]; then GITHUB_PROXY_PREFIX="$_gp_p"; break; fi
  done
  : ${GITHUB_PROXY_PREFIX:=/opt/homebrew}
  unset _gp_p
fi
typeset -g GITHUB_PROXY_BREW_ON="${GITHUB_PROXY_BREW_ON:-1}"   # 0 = 不接管 Homebrew

# 被我们改写之前的值，off 时原样还回去
typeset -g  GITHUB_PROXY_PREV_CURL_PATH GITHUB_PROXY_PREV_GIT_PATH
typeset -gi GITHUB_PROXY_PREV_CURL_SET=0 GITHUB_PROXY_PREV_GIT_SET=0

# ---------------------------------------------------------------------------
# 内部：状态读写
# ---------------------------------------------------------------------------
_gp_state_read() {
  local v=""
  [[ -r "$GITHUB_PROXY_STATE" ]] && v="$(<"$GITHUB_PROXY_STATE" 2>/dev/null)"
  case "$v" in
    off|0|false|no) print -r -- off ;;
    on|1|true|yes)  print -r -- on  ;;
    *)              print -r -- on  ;;   # 默认开启
  esac
}

_gp_enabled() {
  # 状态文件是唯一权威。GITHUB_PROXY 只作为本 shell 内的镜像变量、且不导出，
  # 否则它会被子进程/其它程序继承，出现「文件写着 off 但新终端仍是 on」的假象。
  # 需要临时覆盖时用 GITHUB_PROXY_FORCE=on|off（显式、不会被误继承）。
  case "${GITHUB_PROXY_FORCE-}" in
    on|1|true|yes)  return 0 ;;
    off|0|false|no) return 1 ;;
  esac
  [[ "$(_gp_state_read)" == on ]]
}

_gp_set() {
  local want="$1" dir="${GITHUB_PROXY_STATE:h}"
  [[ -d "$dir" ]] || mkdir -p "$dir" 2>/dev/null
  [[ -w "$dir" ]] && print -r -- "$want" >| "$GITHUB_PROXY_STATE" 2>/dev/null
  export -n GITHUB_PROXY 2>/dev/null      # 不导出：避免泄漏给子进程
  if [[ "$want" == on ]]; then
    GITHUB_PROXY=1
    _gp_brew_enable
  else
    GITHUB_PROXY=0
    _gp_brew_disable
  fi
}

# ---------------------------------------------------------------------------
# Homebrew 接管
#   brew 调 curl/git 时会把非 HOMEBREW_ 前缀的环境变量过滤掉（实测
#   GITHUB_PROXY_MIRROR 传不进包装器），所以镜像地址必须写死在包装器脚本里，
#   每次开启时重新生成一次。
# ---------------------------------------------------------------------------
_gp_brew_available() {
  [[ "$GITHUB_PROXY_BREW_ON" == 0 ]] && return 1
  [[ -x "${GITHUB_PROXY_PREFIX}/bin/brew" ]] || return 1
  return 0
}

_gp_write_brew_wrappers() {
  local dir="$GITHUB_PROXY_BIN" tpl
  [[ -d "$dir" ]] || mkdir -p "$dir" 2>/dev/null
  [[ -d "$dir" ]] || return 1

  # 还原成 brew 原本会用的真实程序
  local real_curl="${GITHUB_PROXY_PREFIX}/opt/curl/bin/curl"
  if [[ -z "${HOMEBREW_FORCE_BREWED_CURL-}" || ! -x "$real_curl" ]]; then
    real_curl="/usr/bin/curl"
  fi
  local real_git="${GITHUB_PROXY_PREFIX}/bin/git"
  [[ -x "$real_git" ]] || real_git="/usr/bin/git"

  # ---- curl 包装器：把 github 域名改写到镜像，其余原样放行 ----
  tpl=$(cat <<'CURL_TPL'
#!/bin/bash
# 由 github_proxy.zsh 自动生成，请勿手改
MIRROR="__MIRROR__"
REAL="__REAL__"
MARKER="__MARKER__"
LOG="__LOG__"
args=()
for a in "$@"; do
  case "$a" in
    https://github.com/*|https://raw.githubusercontent.com/*|https://codeload.github.com/*|https://gist.github.com/*|https://objects.githubusercontent.com/*)
      args+=("${MIRROR}${a}") ;;
    *) args+=("$a") ;;
  esac
done
if [ -e "$MARKER" ]; then
  if [ -f "$LOG" ] && [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then mv -f "$LOG" "$LOG.1" 2>/dev/null; fi
  { printf '== %s\n' "$(date +%T)"; for a in "${args[@]}"; do printf '   %s\n' "$a"; done; } >> "$LOG" 2>/dev/null
fi
exec "$REAL" "${args[@]}"
CURL_TPL
)
  tpl="${tpl//__MIRROR__/$GITHUB_PROXY_MIRROR}"
  tpl="${tpl//__REAL__/$real_curl}"
  tpl="${tpl//__MARKER__/$GITHUB_PROXY_DEBUG_MARKER}"
  tpl="${tpl//__LOG__/$GITHUB_PROXY_BREW_LOG}"
  print -r -- "$tpl" >| "$GITHUB_PROXY_BREW_CURL" 2>/dev/null

  # ---- git 包装器：只读操作走镜像，push 原样放行 ----
  #  关键点：brew update 更新第三方 tap 时执行的是
  #      git -C <tap> fetch --force origin
  #  命令行里没有 URL，地址来自仓库 .git/config 里的 remote.origin.url。
  #  因此除了改写命令行参数，还必须注入 git 原生的 insteadOf 重写规则，
  #  否则这类请求会绕过镜像直接裸连 github.com。
  tpl=$(cat <<'GIT_TPL'
#!/bin/bash
# 由 github_proxy.zsh 自动生成，请勿手改
MIRROR="__MIRROR__"
REAL="__REAL__"
MARKER="__MARKER__"
LOG="__LOG__"
sub=""
for a in "$@"; do
  case "$a" in -*) continue ;; *) sub="$a"; break ;; esac
done
if [ "$sub" = "push" ]; then
  if [ -e "$MARKER" ]; then
    if [ -f "$LOG" ] && [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then mv -f "$LOG" "$LOG.1" 2>/dev/null; fi
    { printf '== %s (push, 原样放行)\n' "$(date +%T)"; for a in "$@"; do printf '   %s\n' "$a"; done; } >> "$LOG" 2>/dev/null
  fi
  exec "$REAL" "$@"
fi
# git 原生重写规则：覆盖 remote.origin.url 这类"写在配置里"的地址
cfg=()
for h in github.com raw.githubusercontent.com codeload.github.com gist.github.com; do
  cfg+=(-c "url.${MIRROR}https://${h}/.insteadOf=https://${h}/")
done
args=()
for a in "$@"; do
  case "$a" in
    https://github.com/*|https://raw.githubusercontent.com/*|https://codeload.github.com/*|git@github.com:*)
      args+=("${MIRROR}${a}") ;;
    *) args+=("$a") ;;
  esac
done
if [ -e "$MARKER" ]; then
  if [ -f "$LOG" ] && [ "$(wc -c < "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then mv -f "$LOG" "$LOG.1" 2>/dev/null; fi
  { printf '== %s\n' "$(date +%T)"; for a in "${args[@]}"; do printf '   %s\n' "$a"; done; } >> "$LOG" 2>/dev/null
fi
exec "$REAL" "${cfg[@]}" "${args[@]}"
GIT_TPL
)
  tpl="${tpl//__MIRROR__/$GITHUB_PROXY_MIRROR}"
  tpl="${tpl//__REAL__/$real_git}"
  tpl="${tpl//__MARKER__/$GITHUB_PROXY_DEBUG_MARKER}"
  tpl="${tpl//__LOG__/$GITHUB_PROXY_BREW_LOG}"
  print -r -- "$tpl" >| "$GITHUB_PROXY_BREW_GIT" 2>/dev/null

  chmod 755 "$GITHUB_PROXY_BREW_CURL" "$GITHUB_PROXY_BREW_GIT" 2>/dev/null
  [[ -x "$GITHUB_PROXY_BREW_CURL" && -x "$GITHUB_PROXY_BREW_GIT" ]]
}

_gp_brew_enable() {
  _gp_brew_available || return 0
  _gp_write_brew_wrappers || return 1

  if (( ! GITHUB_PROXY_PREV_CURL_SET )) &&
     [[ -n "${HOMEBREW_CURL_PATH-}" && "${HOMEBREW_CURL_PATH}" != "$GITHUB_PROXY_BREW_CURL" ]]; then
    GITHUB_PROXY_PREV_CURL_PATH="${HOMEBREW_CURL_PATH}"
    GITHUB_PROXY_PREV_CURL_SET=1
  fi
  export HOMEBREW_CURL_PATH="$GITHUB_PROXY_BREW_CURL"

  if (( ! GITHUB_PROXY_PREV_GIT_SET )) &&
     [[ -n "${HOMEBREW_GIT_PATH-}" && "${HOMEBREW_GIT_PATH}" != "$GITHUB_PROXY_BREW_GIT" ]]; then
    GITHUB_PROXY_PREV_GIT_PATH="${HOMEBREW_GIT_PATH}"
    GITHUB_PROXY_PREV_GIT_SET=1
  fi
  export HOMEBREW_GIT_PATH="$GITHUB_PROXY_BREW_GIT"
}

_gp_brew_disable() {
  if [[ "${HOMEBREW_CURL_PATH-}" == "$GITHUB_PROXY_BREW_CURL" ]]; then
    if (( GITHUB_PROXY_PREV_CURL_SET )) &&
       [[ "${GITHUB_PROXY_PREV_CURL_PATH-}" != "$GITHUB_PROXY_BREW_CURL" ]]; then
      export HOMEBREW_CURL_PATH="${GITHUB_PROXY_PREV_CURL_PATH}"
    else
      unset HOMEBREW_CURL_PATH
    fi
  fi
  if [[ "${HOMEBREW_GIT_PATH-}" == "$GITHUB_PROXY_BREW_GIT" ]]; then
    if (( GITHUB_PROXY_PREV_GIT_SET )) &&
       [[ "${GITHUB_PROXY_PREV_GIT_PATH-}" != "$GITHUB_PROXY_BREW_GIT" ]]; then
      export HOMEBREW_GIT_PATH="${GITHUB_PROXY_PREV_GIT_PATH}"
    else
      unset HOMEBREW_GIT_PATH
    fi
  fi
}

_gp_brew_active() {
  [[ "${HOMEBREW_CURL_PATH-}" == "$GITHUB_PROXY_BREW_CURL" ||
     "${HOMEBREW_GIT_PATH-}" == "$GITHUB_PROXY_BREW_GIT" ]]
}

# ---------------------------------------------------------------------------
# 内部：URL 改写
# ---------------------------------------------------------------------------
_gp_is_github_url() {
  local u="$1" rest host
  [[ "$u" == http://* || "$u" == https://* ]] || return 1
  rest="${u#*://}"
  host="${rest%%/*}"
  host="${host%%:*}"
  host="${host##*@}"
  (( ${GITHUB_PROXY_HOSTS[(I)$host]} ))
}

# 加镜像前缀
_gp_mirror() {
  local u="$1"
  if _gp_is_github_url "$u"; then
    print -r -- "${GITHUB_PROXY_MIRROR}${u}"
  else
    print -r -- "$u"
  fi
}

# 去掉已存在的镜像前缀（复制粘贴带前缀的地址也能正确还原）
_gp_unmirror() {
  local u="$1"
  if [[ "$u" == ${GITHUB_PROXY_MIRROR}* ]]; then
    print -r -- "${u#${GITHUB_PROXY_MIRROR}}"
  else
    print -r -- "$u"
  fi
}

# 归一化 + 按当前开关改写：这是所有包装器共用的出口
_gp_url() {
  local u="$1"
  u="$(_gp_unmirror "$u")"
  if _gp_enabled; then
    _gp_mirror "$u"
  else
    print -r -- "$u"
  fi
}

# ---------------------------------------------------------------------------
# 包装器 1：curl
# ---------------------------------------------------------------------------
curl() {
  local -a args=()
  local a
  for a in "$@"; do
    case "$a" in
      http://*|https://*) args+=("$(_gp_url "$a")") ;;
      *)                  args+=("$a") ;;
    esac
  done
  command curl "${args[@]}"
}

# ---------------------------------------------------------------------------
# 包装器 2：wget
# ---------------------------------------------------------------------------
wget() {
  local -a args=()
  local a
  for a in "$@"; do
    case "$a" in
      http://*|https://*) args+=("$(_gp_url "$a")") ;;
      *)                  args+=("$a") ;;
    esac
  done
  command wget "${args[@]}"
}

# ---------------------------------------------------------------------------
# 内部：把一个仓库（含子模块）里指向镜像的 remote 地址还原成原始地址
#   git clone 会把"实际使用的地址"写进 .git/config，若不还原，之后 push
#   这条 remote 会指向镜像（镜像不支持写操作）。
# ---------------------------------------------------------------------------
_gp_fix_remotes_one() {
  local dir="$1" name url clean
  [[ -d "$dir" ]] || return 0
  for name in ${(f)"$(command git -C "$dir" remote 2>/dev/null)"}; do
    url="$(command git -C "$dir" remote get-url "$name" 2>/dev/null)" || continue
    clean="$(_gp_unmirror "$url")"
    [[ "$clean" == "$url" ]] || command git -C "$dir" remote set-url "$name" "$clean" 2>/dev/null
  done
}

_gp_fix_remotes() {
  local dir="$1" mod
  [[ -d "$dir/.git" ]] || return 0
  _gp_fix_remotes_one "$dir"
  for mod in "$dir"/.git/modules/*(N/); do
    _gp_fix_remotes_one "$mod"
  done
}

# 从 clone 的参数里找出目标目录
_gp_clone_target_dir() {
  local -a args=("$@")
  local i url="" dir=""
  for (( i = 2; i <= $#args; i++ )); do
    local a="${args[i]}"
    if [[ -z "$url" ]]; then
      [[ "$a" == *://* || "$a" == *@*:* ]] && url="$a"
      continue
    fi
    [[ "$a" == -* ]] && continue
    dir="$a"; break
  done
  [[ -n "$url" ]] || return 1
  [[ -n "$dir" ]] || dir="${${url%%\?*}#*/}"      # 去掉 query，取路径最后一段
  dir="${dir%.git}"
  [[ -n "$dir" ]] || return 1
  print -r -- "$dir"
}

# ---------------------------------------------------------------------------
# 包装器 3：git
#   通过注入 git 自身的 URL 重写规则实现：
#     · 读操作（clone/fetch/pull/...）自动走镜像
#     · 写操作（push）不注入任何规则，保持你原有的 SSH 推送习惯
#     · clone 结束后把 remote 还原成原始 github 地址，仓库保持"干净"
# ---------------------------------------------------------------------------
git() {
  if ! _gp_enabled; then
    command git "$@"
    return
  fi

  # 找出子命令（跳过选项）
  local sub="" a
  for a in "$@"; do
    [[ "$a" == -* ]] && continue
    sub="$a"; break
  done

  local m="$GITHUB_PROXY_MIRROR" h
  local -a cfg=()
  for h in github.com raw.githubusercontent.com codeload.github.com \
           gist.github.com objects.githubusercontent.com; do
    cfg+=(-c "url.${m}https://${h}/.insteadOf=https://${h}/")
  done

  command git "${cfg[@]}" "$@"
  local rc=$?

  # clone / submodule 之后收拾 remote 地址
  if (( rc == 0 )); then
    case "$sub" in
      clone)
        local target
        target="$(_gp_clone_target_dir "$@")" && _gp_fix_remotes "$target"
        ;;
      submodule)
        _gp_fix_remotes "$PWD"
        ;;
    esac
  fi
  return $rc
}

# ---------------------------------------------------------------------------
# 对外命令
# ---------------------------------------------------------------------------

# 帮助文本（github_proxy help / -h / --help / usage / 参数写错时显示）
_gp_help() {
  local state="关闭（直连）"
  _gp_enabled && state="开启（走镜像）"

  print -r -- "github_proxy —— GitHub 国内加速开关（当前：${state}）"
  print -r -- ""
  print -r -- "  github_proxy            # 看状态"
  print -r -- "  github_proxy on         # 开启（默认状态）"
  print -r -- "  github_proxy off        # 关闭，全部直连"
  print -r -- "  github_proxy toggle     # 切换"
  print -r -- "  github_proxy test       # 实测镜像 vs 直连速度"
  print -r -- "  github_proxy url <URL>  # 只看改写结果，方便排查"
  print -r -- "  github_proxy brew       # 看 Homebrew 接管状态"
  print -r -- "  github_proxy debug on   # 记录包装器实际请求的地址（排查用）"
  print -r -- ""
  print -r -- "接管范围："
  print -r -- "  git clone / fetch / pull / ls-remote / submodule / archive  → 走镜像"
  print -r -- "  git push                                                   → 不受影响，仍走你的 SSH"
  print -r -- "  curl / wget 中的 github 域名                               → 走镜像"
  print -r -- "  Homebrew 升级时的 github 直连（cask 的 app 包、formula 源码、"
  print -r -- "  tap 的 formula 定义 —— USTC 镜像管不到的部分）              → 走镜像"
  print -r -- ""
  print -r -- "接管不到："
  print -r -- "  npm / pip / go、VS Code、浏览器、focr 等程序自身发起的请求"
  print -r -- "  gh CLI（走 api.github.com，只能用 HTTPS_PROXY）"
  print -r -- "  SSH 形式地址 git@github.com:…"
  print -r -- ""
  local brew_state="未接管"
  _gp_brew_active && brew_state="已接管（brew 的 curl/git → 包装器）"
  print -r -- "Homebrew：${brew_state}"
  print -r -- "镜像：    ${GITHUB_PROXY_MIRROR}   （用 GITHUB_PROXY_MIRROR 环境变量可替换）"
  print -r -- "状态文件：${GITHUB_PROXY_STATE}"
  print -r -- "临时覆盖：GITHUB_PROXY_FORCE=off zsh   （只影响这一次会话，不动状态文件）"
}

github_proxy() {
  local cmd="${1:-status}"
  case "$cmd" in
    on|enable|1)
      _gp_set on
      print -r -- "GitHub 代理：已开启  →  ${GITHUB_PROXY_MIRROR}"
      ;;

    off|disable|0)
      _gp_set off
      print -r -- "GitHub 代理：已关闭  →  直连 github.com（国内通常很慢或超时）"
      ;;

    toggle|switch)
      if _gp_enabled; then github_proxy off; else github_proxy on; fi
      ;;

    status|"")
      local state="关闭（直连）"
      _gp_enabled && state="开启（走镜像）"
      local brew_state="未接管"
      _gp_brew_active && brew_state="已接管"
      print -r -- "GitHub 代理：${state}"
      print -r -- "镜像地址： ${GITHUB_PROXY_MIRROR}"
      print -r -- "Homebrew： ${brew_state}（github_proxy brew 看详情）"
      print -r -- "接管的域名：${(j:, :)GITHUB_PROXY_HOSTS}"
      print -r -- "状态文件： ${GITHUB_PROXY_STATE}"
      ;;

    brew|homebrew)
      local c="未接管" g="未接管" gen="缺失"
      [[ "${HOMEBREW_CURL_PATH-}" == "$GITHUB_PROXY_BREW_CURL" ]] && c="已接管"
      [[ "${HOMEBREW_GIT_PATH-}" == "$GITHUB_PROXY_BREW_GIT" ]] && g="已接管"
      [[ -x "$GITHUB_PROXY_BREW_CURL" && -x "$GITHUB_PROXY_BREW_GIT" ]] && gen="已生成"

      print -r -- "Homebrew 接管：curl ${c} / git ${g}"
      print -r -- "  包装器：        ${gen}（${GITHUB_PROXY_BIN}）"
      print -r -- "  HOMEBREW_CURL_PATH=${HOMEBREW_CURL_PATH:-（未设置）}"
      print -r -- "  HOMEBREW_GIT_PATH =${HOMEBREW_GIT_PATH:-（未设置）}"
      if (( $+commands[brew] )); then
        print -r -- "  brew 实测："
        command brew config 2>/dev/null | command grep -E "^(Curl|Git):" | command sed 's/^/    /'
      fi
      print -r -- "  说明：USTC 镜像管 API / bottles / 两个核心仓库；"
      print -r -- "        cask 的 app 包、formula 源码包、tap 定义仍会直连 github.com，"
      print -r -- "        开启后由本包装器改写（下载完仍由 brew 校验 sha256）。"
      ;;

    debug)
      case "${2:-}" in
        on|1)
          [[ -d "$GITHUB_PROXY_STATE_DIR" ]] || mkdir -p "$GITHUB_PROXY_STATE_DIR" 2>/dev/null
          : >| "$GITHUB_PROXY_DEBUG_MARKER" 2>/dev/null
          print -r -- "调试日志：已开启  →  ${GITHUB_PROXY_BREW_LOG}"
          print -r -- "  （只记录 brew 经包装器发出的请求；用 github_proxy debug off 关闭）"
          ;;
        off|0)
          command rm -f "$GITHUB_PROXY_DEBUG_MARKER" 2>/dev/null
          print -r -- "调试日志：已关闭（日志文件保留在 ${GITHUB_PROXY_BREW_LOG}）"
          ;;
        *)
          if [[ -e "$GITHUB_PROXY_DEBUG_MARKER" ]]; then
            print -r -- "调试日志：开启（${GITHUB_PROXY_BREW_LOG}）"
          else
            print -r -- "调试日志：关闭"
          fi
          ;;
      esac
      ;;

    url)
      if [[ -z "$2" ]]; then
        print -ru2 -- "用法：github_proxy url <URL>"
        return 2
      fi
      print -r -- "$(_gp_url "$2")"
      ;;

    test|check|bench)
      local probe_gh="https://github.com/Dicklesworthstone/franken_ocr/releases/download/models-v1/tokenizer.json"
      print -r -- "探测文件：tokenizer.json (9.5 MB)"
      print -r -- "-- 镜像 --"
      command curl -sL --max-time 25 -o /dev/null \
        -w "   ${GITHUB_PROXY_MIRROR}\n   速度 %{speed_download} B/s  HTTP %{http_code}\n" \
        "${GITHUB_PROXY_MIRROR}${probe_gh}"
      print -r -- "-- 直连 --"
      command curl -sL --max-time 15 -o /dev/null \
        -w "   https://github.com\n   速度 %{speed_download} B/s  HTTP %{http_code}\n" \
        "$probe_gh"
      ;;

    help|-h|--help|usage|-help)
      _gp_help
      ;;

    *)
      print -ru2 -- "github_proxy: 未知参数 '$cmd'"
      print -ru2 -- ""
      _gp_help
      return 2
      ;;
  esac
}

# 让本 shell 内的脚本能判断开关状态：GITHUB_PROXY 故意「不导出」，
# 免得它被子进程继承（曾导致状态文件为 off 时新终端仍判为开启）。
export -n GITHUB_PROXY 2>/dev/null
unset GITHUB_PROXY

# 同步状态 + Homebrew 接管（静默执行，加载时不打印任何东西）
if _gp_enabled; then
  GITHUB_PROXY=1
  _gp_brew_enable 2>/dev/null
else
  GITHUB_PROXY=0
  _gp_brew_disable 2>/dev/null
fi
