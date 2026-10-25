use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Evidence {
    pub file: String,
    pub field: String,
    pub snippet: String,
    pub line: usize,
}

#[derive(Clone, Debug, Default)]
pub struct Extracted {
    pub destinations: Vec<Evidence>,
    pub evals: Vec<Evidence>,
    pub remote_scripts: Vec<Evidence>,
    pub cleartext: Vec<Evidence>,
    pub private_targets: Vec<Evidence>,
    pub api_tabs: Vec<Evidence>,
    pub api_cookies: Vec<Evidence>,
    pub api_proxy: Vec<Evidence>,
    pub api_debugger: Vec<Evidence>,
    pub api_native: Vec<Evidence>,
    pub has_consent_gate: bool,
    pub has_kill_switch: bool,
    pub has_disclosure: bool,
    pub opens_socket_with_consent_false: bool,
}

pub fn scan_files(files: &BTreeMap<String, Vec<u8>>) -> Extracted {
    let mut out = Extracted::default();
    for (name, bytes) in files {
        if !is_text_name(name) {
            continue;
        }
        let Ok(text) = std::str::from_utf8(bytes) else {
            continue;
        };
        scan_text(name, text, &mut out);
    }
    dedup(&mut out.destinations);
    dedup(&mut out.evals);
    dedup(&mut out.remote_scripts);
    dedup(&mut out.cleartext);
    dedup(&mut out.private_targets);
    out
}

fn is_text_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    matches!(
        lower.rsplit('.').next().unwrap_or(""),
        "js" | "mjs" | "cjs" | "html" | "htm" | "css" | "svg" | "txt"
    )
}

fn scan_text(file: &str, text: &str, out: &mut Extracted) {
    let stripped = strip_comments(text);
    if file_has_consent_gate(&stripped) {
        out.has_consent_gate = true;
    }
    if file_has_kill_switch(&stripped) {
        out.has_kill_switch = true;
    }
    if file_has_disclosure(&stripped) {
        out.has_disclosure = true;
    }
    if opens_socket_with_consent_false(&stripped) {
        out.opens_socket_with_consent_false = true;
    }
    find_calls(file, &stripped, "eval(", "eval", &mut out.evals);
    find_phrase(file, &stripped, "new Function", "eval", &mut out.evals);
    find_dynamic_timers(file, &stripped, &mut out.evals);
    find_remote_imports(file, &stripped, &mut out.remote_scripts);
    find_api(file, &stripped, "chrome.tabs", "tabs", &mut out.api_tabs);
    find_api(file, &stripped, "browser.tabs", "tabs", &mut out.api_tabs);
    find_api(
        file,
        &stripped,
        "chrome.cookies",
        "cookies",
        &mut out.api_cookies,
    );
    find_api(
        file,
        &stripped,
        "browser.cookies",
        "cookies",
        &mut out.api_cookies,
    );
    find_api(file, &stripped, "chrome.proxy", "proxy", &mut out.api_proxy);
    find_api(
        file,
        &stripped,
        "browser.proxy",
        "proxy",
        &mut out.api_proxy,
    );
    find_api(
        file,
        &stripped,
        "chrome.debugger",
        "debugger",
        &mut out.api_debugger,
    );
    find_api(
        file,
        &stripped,
        "browser.debugger",
        "debugger",
        &mut out.api_debugger,
    );
    find_api(
        file,
        &stripped,
        "connectNative",
        "nativeMessaging",
        &mut out.api_native,
    );
    for (idx, url) in find_urls(&stripped) {
        let line = line_of(&stripped, idx);
        let host = url_host(&url).unwrap_or_default();
        push_evidence(&mut out.destinations, file, "destination", &url, line);
        if is_cleartext_url(&url) {
            push_evidence(&mut out.cleartext, file, "url", &url, line);
        }
        if is_private_host(&host) {
            push_evidence(&mut out.private_targets, file, "host", &host, line);
        }
        if is_remote_script_context(&stripped, idx) {
            push_evidence(&mut out.remote_scripts, file, "remote_script", &url, line);
        }
    }
}

fn push_evidence(out: &mut Vec<Evidence>, file: &str, field: &str, snippet: &str, line: usize) {
    out.push(Evidence {
        file: file.to_string(),
        field: field.to_string(),
        snippet: snippet.to_string(),
        line,
    });
}

fn dedup(items: &mut Vec<Evidence>) {
    items.sort_by(|a, b| (&a.file, &a.field, &a.snippet).cmp(&(&b.file, &b.field, &b.snippet)));
    items.dedup_by(|a, b| a.file == b.file && a.field == b.field && a.snippet == b.snippet);
}

pub fn opens_socket_with_consent_false(source: &str) -> bool {
    let src = strip_comments(source);
    if !has_socket_api(&src) {
        return false;
    }
    false_branch_has_socket(&src) || assignment_false_reaches_socket(&src)
}

pub fn strip_comments(src: &str) -> String {
    let chars: Vec<char> = src.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '"' || c == '\'' || c == '`' {
            let end = skip_string(&chars, i);
            for ch in &chars[i..end] {
                out.push(*ch);
            }
            i = end;
            continue;
        }
        if c == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
            i += 2;
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i = (i + 2).min(chars.len());
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}

fn skip_string(chars: &[char], start: usize) -> usize {
    let quote = chars[start];
    let mut i = start + 1;
    while i < chars.len() {
        if chars[i] == '\\' {
            i = (i + 2).min(chars.len());
            continue;
        }
        if chars[i] == quote {
            return i + 1;
        }
        i += 1;
    }
    chars.len()
}

fn has_socket_api(src: &str) -> bool {
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if is_socket_call(&chars, i) {
            return true;
        }
        i += 1;
    }
    false
}

fn is_socket_call(chars: &[char], i: usize) -> bool {
    is_fetch_call(chars, i)
        || is_new_websocket(chars, i)
        || ident_at_ignore(chars, i, "XMLHttpRequest")
        || phrase_at(chars, i, "chrome.sockets")
        || phrase_at(chars, i, "browser.sockets")
        || (ident_at(chars, i, "sendBeacon") && next_non_ws_is(chars, i + "sendBeacon".len(), '('))
}

fn is_fetch_call(chars: &[char], i: usize) -> bool {
    ident_at(chars, i, "fetch") && next_non_ws_is(chars, i + 5, '(')
}

fn is_new_websocket(chars: &[char], i: usize) -> bool {
    if !ident_at(chars, i, "new") {
        return false;
    }
    let j = skip_ws(chars, i + 3);
    ident_at_ignore(chars, j, "WebSocket")
}

fn false_branch_has_socket(src: &str) -> bool {
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '"' || chars[i] == '\'' || chars[i] == '`' {
            i = skip_string(&chars, i);
            continue;
        }
        if ident_at(&chars, i, "if") {
            let j = skip_ws(&chars, i + 2);
            if j < chars.len() && chars[j] == '(' {
                if let Some((cond, after)) = take_paren(&chars, j) {
                    let (body, _) = take_body(&chars, after);
                    if condition_is_consent_false(&cond) && has_socket_api(&body) {
                        return true;
                    }
                    let _ = after;
                }
            }
            i += 2;
            continue;
        }
        i += 1;
    }
    false
}

fn assignment_false_reaches_socket(src: &str) -> bool {
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '"' || chars[i] == '\'' || chars[i] == '`' {
            i = skip_string(&chars, i);
            continue;
        }
        if consent_assigned_false(&chars, i) {
            let after = skip_ws(&chars, i + "consent".len());
            let after = skip_assignment_value(&chars, after);
            if socket_before_true_or_block_end(&chars, after) {
                return true;
            }
        }
        i += 1;
    }
    false
}

fn socket_before_true_or_block_end(chars: &[char], start: usize) -> bool {
    let mut i = start;
    let mut depth = 0i32;
    while i < chars.len() {
        if chars[i] == '"' || chars[i] == '\'' || chars[i] == '`' {
            i = skip_string(chars, i);
            continue;
        }
        if chars[i] == '{' {
            depth += 1;
            i += 1;
            continue;
        }
        if chars[i] == '}' && depth == 0 {
            return false;
        }
        if chars[i] == '}' {
            depth -= 1;
            i += 1;
            continue;
        }
        if depth == 0 && consent_assigned_true(chars, i) {
            return false;
        }
        if is_socket_call(chars, i) {
            return true;
        }
        i += 1;
    }
    false
}

fn consent_assigned_false(chars: &[char], i: usize) -> bool {
    if !ident_at_ignore(chars, i, "consent") {
        return false;
    }
    let mut j = skip_ws(chars, i + "consent".len());
    if j >= chars.len() {
        return false;
    }
    if chars[j] == ':' {
        j = skip_ws(chars, j + 1);
        return starts_with_ident(chars, j, "false");
    }
    if chars[j] != '=' || (j + 1 < chars.len() && chars[j + 1] == '=') {
        return false;
    }
    j = skip_ws(chars, j + 1);
    starts_with_ident(chars, j, "false")
}

fn consent_assigned_true(chars: &[char], i: usize) -> bool {
    if !ident_at_ignore(chars, i, "consent") {
        return false;
    }
    let mut j = skip_ws(chars, i + "consent".len());
    if j >= chars.len() || chars[j] != '=' || (j + 1 < chars.len() && chars[j + 1] == '=') {
        return false;
    }
    j = skip_ws(chars, j + 1);
    starts_with_ident(chars, j, "true")
}

fn skip_assignment_value(chars: &[char], mut i: usize) -> usize {
    if i < chars.len() && (chars[i] == ':' || chars[i] == '=') {
        if chars[i] == '=' && i + 1 < chars.len() && chars[i + 1] == '=' {
            return i;
        }
        i += 1;
    }
    skip_ws(chars, i)
}

fn condition_is_consent_false(cond: &str) -> bool {
    if !mentions_consent(cond) {
        return false;
    }
    has_comparison(cond, "===", "false")
        || has_comparison(cond, "==", "false")
        || has_comparison(cond, "!==", "true")
        || has_comparison(cond, "!=", "true")
        || negates_consent(cond)
}

fn mentions_consent(cond: &str) -> bool {
    let chars: Vec<char> = cond.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if ident_at_ignore(&chars, i, "consent") {
            return true;
        }
        i += 1;
    }
    false
}

fn has_comparison(cond: &str, op: &str, literal: &str) -> bool {
    let lower = cond.to_lowercase();
    let bytes = lower.as_bytes();
    let op_b = op.as_bytes();
    let mut i = 0;
    while i + op_b.len() <= bytes.len() {
        if &bytes[i..i + op_b.len()] == op_b {
            let prev_ok = match op {
                "==" => i == 0 || (bytes[i - 1] != b'=' && bytes[i - 1] != b'!'),
                "!=" => i == 0 || bytes[i - 1] != b'=',
                "===" => i == 0 || bytes[i - 1] != b'=',
                "!==" => true,
                _ => true,
            };
            if prev_ok {
                let rest = lower[i + op_b.len()..].trim_start();
                if rest.len() >= literal.len()
                    && rest[..literal.len()].eq_ignore_ascii_case(literal)
                {
                    let boundary = rest.len() == literal.len()
                        || !rest.as_bytes()[literal.len()].is_ascii_alphanumeric();
                    if boundary {
                        return true;
                    }
                }
            }
        }
        i += 1;
    }
    false
}

fn negates_consent(cond: &str) -> bool {
    let chars: Vec<char> = cond.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '"' || chars[i] == '\'' || chars[i] == '`' {
            i = skip_string(&chars, i);
            continue;
        }
        if chars[i] == '!' && (i == 0 || chars[i - 1] != '=') {
            let j = skip_ws(&chars, i + 1);
            if path_ends_with_consent(&chars, j) {
                return true;
            }
        }
        i += 1;
    }
    false
}

fn path_ends_with_consent(chars: &[char], start: usize) -> bool {
    let mut i = start;
    if i >= chars.len() || !is_ident_start(chars[i]) {
        return false;
    }
    loop {
        let s = i;
        i += 1;
        while i < chars.len() && is_ident_char(chars[i]) {
            i += 1;
        }
        let last: String = chars[s..i].iter().collect();
        let mut k = skip_ws(chars, i);
        if k < chars.len() && chars[k] == '.' {
            k = skip_ws(chars, k + 1);
            i = k;
            if i >= chars.len() || !is_ident_start(chars[i]) {
                return false;
            }
            continue;
        }
        return last.eq_ignore_ascii_case("consent");
    }
}

fn take_paren(chars: &[char], open: usize) -> Option<(String, usize)> {
    if chars.get(open) != Some(&'(') {
        return None;
    }
    let mut depth = 0i32;
    let mut i = open;
    let start = open + 1;
    while i < chars.len() {
        if chars[i] == '"' || chars[i] == '\'' || chars[i] == '`' {
            i = skip_string(chars, i);
            continue;
        }
        if chars[i] == '(' {
            depth += 1;
        } else if chars[i] == ')' {
            depth -= 1;
            if depth == 0 {
                return Some((chars[start..i].iter().collect(), i + 1));
            }
        }
        i += 1;
    }
    None
}

fn take_body(chars: &[char], mut i: usize) -> (String, usize) {
    i = skip_ws(chars, i);
    if i >= chars.len() {
        return (String::new(), i);
    }
    if chars[i] == '{' {
        let start = i;
        let mut depth = 0i32;
        while i < chars.len() {
            if chars[i] == '"' || chars[i] == '\'' || chars[i] == '`' {
                i = skip_string(chars, i);
                continue;
            }
            if chars[i] == '{' {
                depth += 1;
            } else if chars[i] == '}' {
                depth -= 1;
                if depth == 0 {
                    return (chars[start..=i].iter().collect(), i + 1);
                }
            }
            i += 1;
        }
        return (chars[start..].iter().collect(), chars.len());
    }
    let start = i;
    while i < chars.len() && chars[i] != ';' && chars[i] != '\n' {
        i += 1;
    }
    (chars[start..i].iter().collect(), i)
}

fn file_has_consent_gate(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("consent")
        && (lower.contains("opt-in")
            || lower.contains("opt in")
            || lower.contains("optin")
            || lower.contains("=== true")
            || lower.contains("== true")
            || lower.contains("!== true")
            || lower.contains("!= true"))
}

fn file_has_kill_switch(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("kill_switch")
        || lower.contains("killswitch")
        || lower.contains("kill-switch")
        || lower.contains(":kill")
        || lower.contains("\"kill\"")
        || lower.contains("'kill'")
}

fn file_has_disclosure(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("disclosure")
        || lower.contains("privacy")
        || lower.contains("opt-in")
        || lower.contains("opt in")
}

fn find_calls(file: &str, text: &str, token: &str, field: &str, out: &mut Vec<Evidence>) {
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '"' || chars[i] == '\'' || chars[i] == '`' {
            i = skip_string(&chars, i);
            continue;
        }
        if token == "eval(" && ident_at(&chars, i, "eval") && next_non_ws_is(&chars, i + 4, '(') {
            let byte = byte_index(text, i);
            push_evidence(out, file, field, "eval(", line_of(text, byte));
        }
        i += 1;
    }
}

fn find_phrase(file: &str, text: &str, phrase: &str, field: &str, out: &mut Vec<Evidence>) {
    let mut start = 0;
    while let Some(rel) = text[start..].find(phrase) {
        let idx = start + rel;
        if idx == 0 || !is_ident_char(text[idx..].chars().next().unwrap_or(' ')) {
            push_evidence(out, file, field, phrase, line_of(text, idx));
        }
        start = idx + phrase.len();
    }
}

fn find_dynamic_timers(file: &str, text: &str, out: &mut Vec<Evidence>) {
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '"' || chars[i] == '\'' || chars[i] == '`' {
            i = skip_string(&chars, i);
            continue;
        }
        for name in ["setTimeout", "setInterval"] {
            if ident_at(&chars, i, name) {
                let j = skip_ws(&chars, i + name.len());
                if j < chars.len() && chars[j] == '(' {
                    let k = skip_ws(&chars, j + 1);
                    if k < chars.len() && (chars[k] == '"' || chars[k] == '\'' || chars[k] == '`') {
                        let byte = byte_index(text, i);
                        push_evidence(out, file, "eval", &format!("{name}("), line_of(text, byte));
                    }
                }
            }
        }
        i += 1;
    }
}

fn find_remote_imports(file: &str, text: &str, out: &mut Vec<Evidence>) {
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '"' || chars[i] == '\'' || chars[i] == '`' {
            i = skip_string(&chars, i);
            continue;
        }
        if ident_at(&chars, i, "importScripts") {
            let j = skip_ws(&chars, i + "importScripts".len());
            if j < chars.len() && chars[j] == '(' {
                if let Some((args, _)) = take_paren(&chars, j) {
                    for (_, url) in find_urls(&args) {
                        if url.starts_with("http://")
                            || url.starts_with("https://")
                            || url.starts_with("wss://")
                            || url.starts_with("ws://")
                        {
                            let byte = byte_index(text, i);
                            push_evidence(out, file, "remote_script", &url, line_of(text, byte));
                        }
                    }
                }
            }
        }
        i += 1;
    }
}

fn find_api(file: &str, text: &str, phrase: &str, field: &str, out: &mut Vec<Evidence>) {
    let mut start = 0;
    while let Some(rel) = text[start..].find(phrase) {
        let idx = start + rel;
        push_evidence(out, file, field, phrase, line_of(text, idx));
        start = idx + phrase.len();
    }
}

fn is_remote_script_context(text: &str, url_idx: usize) -> bool {
    let start = url_idx.saturating_sub(180);
    let window = &text[start..url_idx];
    let lower = window.to_lowercase();
    lower.contains("<script") || lower.contains("import(") || lower.contains("importscripts")
}

pub fn find_urls(text: &str) -> Vec<(usize, String)> {
    let schemes = ["https://", "http://", "wss://", "ws://"];
    let lower = text.to_lowercase();
    let bytes = lower.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let mut matched = None;
        for scheme in schemes {
            if bytes[i..].starts_with(scheme.as_bytes()) {
                matched = Some(scheme.len());
                break;
            }
        }
        if matched.is_some() {
            let end = scan_url_end(text, i);
            let mut url = text[i..end].to_string();
            while url.ends_with(['.', ',', ';', ')', ']', '}']) {
                url.pop();
            }
            if url.len() > 8 {
                out.push((i, url));
            }
            i = end.max(i + 1);
            continue;
        }
        i += 1;
    }
    out
}

fn scan_url_end(text: &str, start: usize) -> usize {
    let bytes = text.as_bytes();
    let mut i = start;
    while i < bytes.len() {
        let c = bytes[i];
        if c.is_ascii_whitespace()
            || matches!(
                c,
                b'"' | b'\'' | b'`' | b'<' | b'>' | b')' | b'(' | b'{' | b'}'
            )
        {
            break;
        }
        i += 1;
    }
    i
}

pub fn url_host(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let hostport = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let hostport = hostport.split('@').next_back().unwrap_or(hostport);
    let host = if let Some(inner) = hostport.strip_prefix('[') {
        inner.split(']').next().unwrap_or(inner)
    } else if hostport.matches(':').count() == 1 {
        hostport.split(':').next().unwrap_or(hostport)
    } else {
        hostport
    };
    if host.is_empty() {
        None
    } else {
        Some(host.to_lowercase())
    }
}

pub fn is_cleartext_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.starts_with("http://") || lower.starts_with("ws://")
}

pub fn is_private_host(host: &str) -> bool {
    let host = host
        .trim()
        .trim_matches(|c| c == '[' || c == ']')
        .to_lowercase();
    if host.is_empty() {
        return false;
    }
    if host == "localhost"
        || host == "::1"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
    {
        return true;
    }
    if host.starts_with("fe80:") || host.starts_with("fc") || host.starts_with("fd") {
        if host.contains(':') {
            return true;
        }
    }
    let Some(parts) = parse_ipv4(&host) else {
        return false;
    };
    let [a, b, _, _] = parts;
    a == 0
        || a == 10
        || a == 127
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 169 && b == 254)
}

fn parse_ipv4(host: &str) -> Option<[u8; 4]> {
    let mut out = [0u8; 4];
    let mut parts = host.split('.');
    for slot in &mut out {
        let part = parts.next()?;
        if part.is_empty() || part.len() > 3 || !part.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        *slot = part.parse().ok()?;
    }
    if parts.next().is_some() {
        return None;
    }
    Some(out)
}

fn line_of(text: &str, byte_idx: usize) -> usize {
    let end = byte_idx.min(text.len());
    text[..end].bytes().filter(|b| *b == b'\n').count() + 1
}

fn byte_index(text: &str, char_idx: usize) -> usize {
    text.chars().take(char_idx).map(|c| c.len_utf8()).sum()
}

fn ident_at(chars: &[char], i: usize, word: &str) -> bool {
    let w: Vec<char> = word.chars().collect();
    if i + w.len() > chars.len() || chars[i..i + w.len()] != w[..] {
        return false;
    }
    if i > 0 && is_ident_char(chars[i - 1]) {
        return false;
    }
    if i + w.len() < chars.len() && is_ident_char(chars[i + w.len()]) {
        return false;
    }
    true
}

fn ident_at_ignore(chars: &[char], i: usize, word: &str) -> bool {
    let w: Vec<char> = word.chars().flat_map(|c| c.to_lowercase()).collect();
    if i + w.len() > chars.len() {
        return false;
    }
    for (a, b) in chars[i..i + w.len()].iter().zip(w.iter()) {
        if a.to_lowercase().next() != Some(*b) {
            return false;
        }
    }
    if i > 0 && is_ident_char(chars[i - 1]) {
        return false;
    }
    if i + w.len() < chars.len() && is_ident_char(chars[i + w.len()]) {
        return false;
    }
    true
}

fn phrase_at(chars: &[char], i: usize, phrase: &str) -> bool {
    let w: Vec<char> = phrase.chars().collect();
    i + w.len() <= chars.len() && chars[i..i + w.len()] == w[..]
}

fn starts_with_ident(chars: &[char], i: usize, word: &str) -> bool {
    ident_at_ignore(chars, i, word)
}

fn next_non_ws_is(chars: &[char], i: usize, expect: char) -> bool {
    let j = skip_ws(chars, i);
    j < chars.len() && chars[j] == expect
}

fn skip_ws(chars: &[char], mut i: usize) -> usize {
    while i < chars.len() && chars[i].is_whitespace() {
        i += 1;
    }
    i
}

fn is_ident_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_' || c == '$'
}

fn is_ident_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '$'
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn comments_do_not_eat_urls() {
        let src = "const u = \"https://relay.harbor.example/v1\"; // consent = false\n";
        let stripped = strip_comments(src);
        assert!(stripped.contains("https://relay.harbor.example/v1"));
        assert!(!stripped.contains("consent = false"));
    }

    #[test]
    fn flags_assignment_and_false_branch() {
        let assigned =
            "const consent = false;\nnew WebSocket(\"wss://relay.harbor.example/v1\");\n";
        assert!(opens_socket_with_consent_false(assigned));
        let branch = "if (consent === false) {\n  fetch(\"https://relay.harbor.example/v1\");\n}\n";
        assert!(opens_socket_with_consent_false(branch));
        let negated = "if (!consent) { new WebSocket(\"wss://relay.harbor.example/v1\"); }\n";
        assert!(opens_socket_with_consent_false(negated));
    }

    #[test]
    fn harbor_clean_relay_does_not_open_socket_when_consent_is_false() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures/harbor-node/clean-relay/background.js");
        let src = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
        assert!(
            !opens_socket_with_consent_false(&src),
            "Harbor opened a socket with consent=false"
        );
    }

    #[test]
    fn gated_early_return_is_not_a_false_open() {
        let src = r#"
            async function maybeRelay() {
              const stored = await chrome.storage.local.get("consent");
              if (stored.consent !== true) {
                return;
              }
              const ws = new WebSocket("wss://relay.harbor.example/v1/session");
            }
        "#;
        assert!(!opens_socket_with_consent_false(src));
    }
}
