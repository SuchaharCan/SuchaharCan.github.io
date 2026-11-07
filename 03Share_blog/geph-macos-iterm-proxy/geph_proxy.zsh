# geph_proxy.zsh —— macOS / iTerm / zsh 的 Geph 终端代理开关
#
# Geph 默认本地代理端口：
#   HTTP   127.0.0.1:9910
#   SOCKS5 127.0.0.1:9909
#
# 用法：
#   geph_proxy on       开启代理、验证外网并测速
#   geph_proxy on --quick
#                       开启并验证外网，但不下载测速
#   geph_proxy off      清除当前终端代理
#   geph_proxy test     重新验证并测速
#   geph_proxy status   查看当前代理变量
#   geph_proxy ports    检查 Geph 实际监听端口

typeset -g GEPH_PROXY_HOST="${GEPH_PROXY_HOST:-127.0.0.1}"
typeset -g GEPH_HTTP_PORT="${GEPH_HTTP_PORT:-9910}"
typeset -g GEPH_SOCKS_PORT="${GEPH_SOCKS_PORT:-9909}"

typeset -g GEPH_CHECK_URL="${GEPH_CHECK_URL:-https://www.gstatic.com/generate_204}"
typeset -g GEPH_CHECK_TIMEOUT="${GEPH_CHECK_TIMEOUT:-6}"
typeset -g GEPH_SPEED_URL="${GEPH_SPEED_URL:-https://speed.cloudflare.com/__down?bytes=10000000}"
typeset -g GEPH_SPEED_MAX_TIME="${GEPH_SPEED_MAX_TIME:-20}"
typeset -g GEPH_AUTO_START="${GEPH_AUTO_START:-1}"
typeset -g GEPH_START_WAIT="${GEPH_START_WAIT:-15}"

# 这些域名由支持 no_proxy 的终端工具直接访问，不走 Geph。
# .cn 可覆盖大部分国内域名；常见 .com 国内站点单独列出。
typeset -ga GEPH_NO_PROXY_DOMAINS=(
    localhost
    127.0.0.1
    ::1
    .local
    .cn
    .baidu.com
    .bdstatic.com
    .qq.com
    .tencent.com
    .weixin.qq.com
    .wechat.com
    .aliyun.com
    .alibaba.com
    .taobao.com
    .tmall.com
    .alicdn.com
    .jd.com
    .sina.com.cn
    .weibo.com
    .bilibili.com
    .biliapi.net
    .hdslb.com
    .douyin.com
    .bytedance.com
    .toutiao.com
    .163.com
    .126.net
    .zhihu.com
    .xiaohongshu.com
    .csdn.net
    .gitee.com
    .cnblogs.com
    .oschina.net
    .huaweicloud.com
    .volces.com
)

if [[ -n "${GEPH_EXTRA_NO_PROXY:-}" ]]; then
    GEPH_NO_PROXY_DOMAINS+=("${(@s:,:)GEPH_EXTRA_NO_PROXY}")
fi

typeset -g GEPH_PROXY_NO_PROXY="${GEPH_PROXY_NO_PROXY:-${(j:,:)GEPH_NO_PROXY_DOMAINS}}"
typeset -g GEPH_PROXY_ACTIVE_NAME="${GEPH_PROXY_ACTIVE_NAME:-}"
typeset -g GEPH_PROXY_ACTIVE_URL="${GEPH_PROXY_ACTIVE_URL:-}"

typeset -g _GEPH_PROBE_STATUS=0
typeset -g _GEPH_PROBE_CODE="000"
typeset -g _GEPH_PROBE_TTFB="0"

_geph_clear_env() {
    unset http_proxy https_proxy all_proxy no_proxy
    unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY
}

_geph_apply_url() {
    local proxy_url="$1"

    export http_proxy="$proxy_url"
    export https_proxy="$proxy_url"
    export HTTP_PROXY="$proxy_url"
    export HTTPS_PROXY="$proxy_url"
    export all_proxy="$proxy_url"
    export ALL_PROXY="$proxy_url"
    export no_proxy="$GEPH_PROXY_NO_PROXY"
    export NO_PROXY="$GEPH_PROXY_NO_PROXY"
}

_geph_probe() {
    emulate -L zsh

    local proxy_url="$1"
    local result code ttfb probe_status

    if ! (( $+commands[curl] )); then
        _GEPH_PROBE_STATUS=127
        _GEPH_PROBE_CODE="000"
        _GEPH_PROBE_TTFB="0"
        return 1
    fi

    result="$(
        curl \
            --proxy "$proxy_url" \
            --noproxy "" \
            --location \
            --silent \
            --connect-timeout 3 \
            --max-time "$GEPH_CHECK_TIMEOUT" \
            --output /dev/null \
            --write-out $'%{http_code}\t%{time_starttransfer}' \
            "$GEPH_CHECK_URL" \
            2>/dev/null
    )"
    probe_status=$?

    local IFS=$'\t'
    read -r code ttfb <<< "$result"

    _GEPH_PROBE_STATUS="$probe_status"
    _GEPH_PROBE_CODE="${code:-000}"
    _GEPH_PROBE_TTFB="${ttfb:-0}"

    (( probe_status == 0 )) &&
        [[ "$_GEPH_PROBE_CODE" =~ '^[0-9]+$' ]] &&
        (( _GEPH_PROBE_CODE >= 200 && _GEPH_PROBE_CODE < 400 ))
}

_geph_probe_reason() {
    case "$_GEPH_PROBE_STATUS" in
        7)
            print -n -- "端口未监听或连接被拒绝"
            ;;
        28)
            print -n -- "代理 CONNECT 超时"
            ;;
        35|56)
            print -n -- "TLS/隧道连接失败"
            ;;
        127)
            print -n -- "未安装 curl"
            ;;
        0)
            print -n -- "HTTP ${_GEPH_PROBE_CODE}"
            ;;
        *)
            print -n -- "curl=${_GEPH_PROBE_STATUS}, HTTP=${_GEPH_PROBE_CODE}"
            ;;
    esac
}

_geph_activate() {
    local name="$1"
    local proxy_url="$2"
    local latency_ms

    latency_ms="$(awk -v seconds="$_GEPH_PROBE_TTFB" 'BEGIN { printf "%.0f", seconds * 1000 }')"

    GEPH_PROXY_ACTIVE_NAME="$name"
    GEPH_PROXY_ACTIVE_URL="$proxy_url"
    _geph_apply_url "$proxy_url"

    print -- "✓ ${name} 可用：${proxy_url}（${latency_ms} ms）"
}

_geph_port_open() {
    emulate -L zsh

    (( $+commands[nc] )) || return 1
    nc -z -G 1 -w 1 "$1" "$2" >/dev/null 2>&1
}

_geph_launch_and_wait() {
    emulate -L zsh

    (( GEPH_AUTO_START )) || return 1

    local wait_seconds="$GEPH_START_WAIT"
    if pgrep -f gephgui-wry >/dev/null 2>&1; then
        print -- "Geph 已运行，但本地代理端口尚未开放，等待 ${wait_seconds}s..."
        if (( wait_seconds > 6 )); then
            wait_seconds=6
        fi
    else
        print -- "Geph 未运行，正在后台启动..."
        if [[ -d /Applications/Geph.app ]]; then
            open -g /Applications/Geph.app >/dev/null 2>&1 || return 1
        else
            open -g -a Geph >/dev/null 2>&1 || return 1
        fi
    fi

    local i port_ready=0
    for (( i = 1; i <= wait_seconds; i++ )); do
        sleep 1
        if _geph_port_open "$GEPH_PROXY_HOST" "$GEPH_HTTP_PORT" ||
           _geph_port_open "$GEPH_PROXY_HOST" "$GEPH_SOCKS_PORT"; then
            port_ready=1
            break
        fi
    done

    (( port_ready )) || return 1

    local http_url="http://${GEPH_PROXY_HOST}:${GEPH_HTTP_PORT}"
    local socks_url="socks5h://${GEPH_PROXY_HOST}:${GEPH_SOCKS_PORT}"

    if _geph_probe "$http_url"; then
        _geph_activate "Geph HTTP" "$http_url"
        return 0
    fi

    if _geph_probe "$socks_url"; then
        _geph_activate "Geph SOCKS5" "$socks_url"
        return 0
    fi

    return 1
}

_geph_select() {
    emulate -L zsh

    GEPH_PROXY_ACTIVE_NAME=""
    GEPH_PROXY_ACTIVE_URL=""
    _geph_clear_env

    local http_url="http://${GEPH_PROXY_HOST}:${GEPH_HTTP_PORT}"
    local socks_url="socks5h://${GEPH_PROXY_HOST}:${GEPH_SOCKS_PORT}"

    print -- "正在测试 Geph HTTP ${GEPH_PROXY_HOST}:${GEPH_HTTP_PORT}..."
    if _geph_probe "$http_url"; then
        _geph_activate "Geph HTTP" "$http_url"
        return 0
    fi
    print -- "  HTTP 不可用：$(_geph_probe_reason)"

    print -- "正在测试 Geph SOCKS5 ${GEPH_PROXY_HOST}:${GEPH_SOCKS_PORT}..."
    if _geph_probe "$socks_url"; then
        _geph_activate "Geph SOCKS5" "$socks_url"
        return 0
    fi
    print -- "  SOCKS5 不可用：$(_geph_probe_reason)"

    if _geph_launch_and_wait; then
        return 0
    fi

    _geph_clear_env
    GEPH_PROXY_ACTIVE_NAME=""
    GEPH_PROXY_ACTIVE_URL=""
    return 1
}

_geph_speed_test() {
    emulate -L zsh

    local proxy_url="${1:-$GEPH_PROXY_ACTIVE_URL}"
    local result curl_status
    local code connect_time start_transfer bytes speed_bps
    local mbps mbs first_byte_ms

    if [[ -z "$proxy_url" ]]; then
        print -ru2 -- "✗ 当前没有已验证的 Geph 代理。"
        return 1
    fi

    print -- "正在测试下载速度..."
    result="$(
        curl \
            --proxy "$proxy_url" \
            --noproxy "" \
            --location \
            --silent \
            --connect-timeout 5 \
            --max-time "$GEPH_SPEED_MAX_TIME" \
            --output /dev/null \
            --write-out $'%{http_code}\t%{time_connect}\t%{time_starttransfer}\t%{size_download}\t%{speed_download}' \
            "$GEPH_SPEED_URL" \
            2>/dev/null
    )"
    curl_status=$?

    local IFS=$'\t'
    read -r code connect_time start_transfer bytes speed_bps <<< "$result"

    if [[ ! "$bytes" =~ '^[0-9]+$' ]] || (( bytes <= 0 )); then
        print -ru2 -- "✗ 下载测速失败（curl 状态：${curl_status}）。"
        print -ru2 -- "  外网连通性已经通过，但测速服务本次不可用。"
        return 0
    fi

    if [[ "$code" =~ '^[0-9]+$' ]] && (( code >= 400 )); then
        print -ru2 -- "✗ 测速地址返回 HTTP ${code}。"
        return 0
    fi

    mbps="$(awk -v bps="$speed_bps" 'BEGIN { printf "%.2f", bps * 8 / 1000000 }')"
    mbs="$(awk -v bps="$speed_bps" 'BEGIN { printf "%.2f", bps / 1048576 }')"
    first_byte_ms="$(awk -v seconds="$start_transfer" 'BEGIN { printf "%.0f", seconds * 1000 }')"

    if (( curl_status == 28 )); then
        print -- "✓ Geph 可用，测试期间达到：${mbps} Mbps（${mbs} MB/s，首字节 ${first_byte_ms} ms）"
        print -- "  下载在 ${GEPH_SPEED_MAX_TIME}s 上限处结束，因此这是下限值。"
    else
        print -- "✓ Geph 可用，网速：${mbps} Mbps（${mbs} MB/s，首字节 ${first_byte_ms} ms）"
    fi
}

geph_proxy_ports() {
    emulate -L zsh

    local port state missing=0
    print -- "Geph 本地代理端口："

    for port in "$GEPH_HTTP_PORT" "$GEPH_SOCKS_PORT"; do
        if _geph_port_open "$GEPH_PROXY_HOST" "$port"; then
            state="✓ 正在监听"
        else
            state="✗ 未监听"
            missing=1
        fi
        printf '  %-5s %s\n' "$port" "$state"
    done

    if (( $+commands[lsof] )); then
        print -- ""
        print -- "lsof 详情："
        lsof -nP -iTCP:"$GEPH_HTTP_PORT" -iTCP:"$GEPH_SOCKS_PORT" -sTCP:LISTEN 2>/dev/null ||
            print -- "  （无匹配监听）"
    fi

    (( missing == 0 ))
}

geph_proxy_status() {
    emulate -L zsh

    if [[ -n "$GEPH_PROXY_ACTIVE_NAME" ]]; then
        print -- "活动代理：${GEPH_PROXY_ACTIVE_NAME}"
        print -- "代理地址：${GEPH_PROXY_ACTIVE_URL}"
    else
        print -- "活动代理：（未选择）"
    fi

    local name value
    for name in http_proxy https_proxy all_proxy no_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY; do
        value="${(P)name}"
        if [[ -n "$value" ]]; then
            printf '%-12s %s\n' "$name" "$value"
        else
            printf '%-12s %s\n' "$name" "（未设置）"
        fi
    done
}

geph_proxy() {
    emulate -L zsh

    local action="${1:-on}"

    case "$action" in
        on|start)
            if ! _geph_select; then
                print -ru2 -- "✗ Geph 没有提供可访问外网的本地代理。"
                print -ru2 -- "  请确认“设置 → 本地代理”已开启，并核对端口 ${GEPH_SOCKS_PORT}/${GEPH_HTTP_PORT}。"
                print -ru2 -- "  当前终端代理变量已清除。"
                return 1
            fi

            print -- "✓ 当前终端已接入：${GEPH_PROXY_ACTIVE_NAME}"
            if [[ "${2:-}" != "--quick" ]]; then
                _geph_speed_test "$GEPH_PROXY_ACTIVE_URL"
            fi
            ;;
        off|stop|unproxy)
            _geph_clear_env
            GEPH_PROXY_ACTIVE_NAME=""
            GEPH_PROXY_ACTIVE_URL=""
            print -- "✓ 已清除当前终端的 Geph 代理变量。"
            ;;
        test)
            if [[ -z "$GEPH_PROXY_ACTIVE_URL" ]]; then
                if ! _geph_select; then
                    return 1
                fi
            elif ! _geph_probe "$GEPH_PROXY_ACTIVE_URL"; then
                print -ru2 -- "✗ 当前代理不可用：$(_geph_probe_reason)"
                _geph_clear_env
                GEPH_PROXY_ACTIVE_NAME=""
                GEPH_PROXY_ACTIVE_URL=""
                return 1
            fi
            _geph_speed_test "$GEPH_PROXY_ACTIVE_URL"
            ;;
        status)
            geph_proxy_status
            ;;
        ports)
            geph_proxy_ports
            ;;
        -h|--help|help)
            print -- "用法：geph_proxy [on [--quick]|off|test|status|ports]"
            ;;
        *)
            print -ru2 -- "geph_proxy: 未知参数 '$action'"
            print -ru2 -- "运行 geph_proxy help 查看用法。"
            return 2
            ;;
    esac
}
