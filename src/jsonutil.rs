#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Number(String),
    String(String),
    Array(Vec<Json>),
    Object(Vec<(String, Json)>),
}

impl Json {
    pub fn int(n: i64) -> Self {
        Json::Number(n.to_string())
    }

    pub fn string(s: impl Into<String>) -> Self {
        Json::String(s.into())
    }

    pub fn array_strings(items: &[String]) -> Self {
        Json::Array(items.iter().cloned().map(Json::String).collect())
    }

    pub fn object(pairs: Vec<(&str, Json)>) -> Self {
        Json::Object(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }

    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(pairs) => pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Json::Number(s) => s.parse().ok(),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Json::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[Json]> {
        match self {
            Json::Array(items) => Some(items),
            _ => None,
        }
    }

    pub fn string_list(&self) -> Vec<String> {
        match self {
            Json::Array(items) => items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
            Json::String(s) => vec![s.clone()],
            _ => Vec::new(),
        }
    }

    pub fn to_pretty(&self) -> String {
        let mut out = String::new();
        write_pretty(&mut out, self, 0);
        out.push('\n');
        out
    }
}

pub fn parse(input: &str) -> Result<Json, String> {
    let input = input.strip_prefix('\u{feff}').unwrap_or(input);
    let mut parser = Parser { s: input, i: 0 };
    let value = parser.parse_value()?;
    parser.skip();
    if parser.i != parser.s.len() {
        return Err(format!("trailing data at byte {}", parser.i));
    }
    Ok(value)
}

struct Parser<'a> {
    s: &'a str,
    i: usize,
}

impl<'a> Parser<'a> {
    fn parse_value(&mut self) -> Result<Json, String> {
        self.skip();
        let rest = self.rest();
        if rest.starts_with("null") {
            self.i += 4;
            return Ok(Json::Null);
        }
        if rest.starts_with("true") {
            self.i += 4;
            return Ok(Json::Bool(true));
        }
        if rest.starts_with("false") {
            self.i += 5;
            return Ok(Json::Bool(false));
        }
        match rest.chars().next() {
            Some('"') => Ok(Json::String(self.parse_string()?)),
            Some('[') => self.parse_array(),
            Some('{') => self.parse_object(),
            Some('-') | Some('0'..='9') => self.parse_number(),
            Some(c) => Err(format!("unexpected '{c}' at byte {}", self.i)),
            None => Err("unexpected end of json".into()),
        }
    }

    fn parse_array(&mut self) -> Result<Json, String> {
        self.bump_char()?;
        let mut items = Vec::new();
        self.skip();
        if self.rest().starts_with(']') {
            self.i += 1;
            return Ok(Json::Array(items));
        }
        loop {
            items.push(self.parse_value()?);
            self.skip();
            if self.rest().starts_with(',') {
                self.i += 1;
                continue;
            }
            if self.rest().starts_with(']') {
                self.i += 1;
                break;
            }
            return Err(format!("expected ',' or ']' at byte {}", self.i));
        }
        Ok(Json::Array(items))
    }

    fn parse_object(&mut self) -> Result<Json, String> {
        self.bump_char()?;
        let mut pairs = Vec::new();
        self.skip();
        if self.rest().starts_with('}') {
            self.i += 1;
            return Ok(Json::Object(pairs));
        }
        loop {
            self.skip();
            if !self.rest().starts_with('"') {
                return Err(format!("expected string key at byte {}", self.i));
            }
            let key = self.parse_string()?;
            self.skip();
            if !self.rest().starts_with(':') {
                return Err(format!("expected ':' at byte {}", self.i));
            }
            self.i += 1;
            let value = self.parse_value()?;
            if let Some(existing) = pairs.iter_mut().find(|(k, _)| k == &key) {
                existing.1 = value;
            } else {
                pairs.push((key, value));
            }
            self.skip();
            if self.rest().starts_with(',') {
                self.i += 1;
                continue;
            }
            if self.rest().starts_with('}') {
                self.i += 1;
                break;
            }
            return Err(format!("expected ',' or '}}' at byte {}", self.i));
        }
        Ok(Json::Object(pairs))
    }

    fn parse_number(&mut self) -> Result<Json, String> {
        let start = self.i;
        if self.rest().starts_with('-') {
            self.i += 1;
        }
        let rest = self.rest();
        if rest.starts_with('0') {
            self.i += 1;
        } else if rest.starts_with(|c: char| c.is_ascii_digit()) {
            while self.rest().starts_with(|c: char| c.is_ascii_digit()) {
                self.i += 1;
            }
        } else {
            return Err(format!("invalid number at byte {}", self.i));
        }
        if self.rest().starts_with('.') {
            self.i += 1;
            if !self.rest().starts_with(|c: char| c.is_ascii_digit()) {
                return Err(format!("invalid number at byte {}", self.i));
            }
            while self.rest().starts_with(|c: char| c.is_ascii_digit()) {
                self.i += 1;
            }
        }
        if self.rest().starts_with('e') || self.rest().starts_with('E') {
            self.i += 1;
            if self.rest().starts_with('+') || self.rest().starts_with('-') {
                self.i += 1;
            }
            if !self.rest().starts_with(|c: char| c.is_ascii_digit()) {
                return Err(format!("invalid number at byte {}", self.i));
            }
            while self.rest().starts_with(|c: char| c.is_ascii_digit()) {
                self.i += 1;
            }
        }
        Ok(Json::Number(self.s[start..self.i].to_string()))
    }

    fn parse_string(&mut self) -> Result<String, String> {
        if !self.rest().starts_with('"') {
            return Err(format!("expected string at byte {}", self.i));
        }
        self.i += 1;
        let mut out = String::new();
        loop {
            let ch = self.bump_char()?;
            match ch {
                '"' => return Ok(out),
                '\\' => {
                    let esc = self.bump_char()?;
                    match esc {
                        '"' => out.push('"'),
                        '\\' => out.push('\\'),
                        '/' => out.push('/'),
                        'b' => out.push('\u{0008}'),
                        'f' => out.push('\u{000c}'),
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'u' => {
                            if self.i + 4 > self.s.len() {
                                return Err("bad unicode escape".into());
                            }
                            let hex = &self.s[self.i..self.i + 4];
                            self.i += 4;
                            let cp =
                                u32::from_str_radix(hex, 16).map_err(|_| "bad unicode escape")?;
                            let ch = char::from_u32(cp).ok_or("bad unicode escape")?;
                            out.push(ch);
                        }
                        _ => return Err(format!("invalid escape '\\{esc}'")),
                    }
                }
                c => out.push(c),
            }
        }
    }

    fn skip(&mut self) {
        while let Some(c) = self.rest().chars().next() {
            if c == ' ' || c == '\n' || c == '\r' || c == '\t' {
                self.i += c.len_utf8();
            } else {
                break;
            }
        }
    }

    fn rest(&self) -> &'a str {
        &self.s[self.i..]
    }

    fn bump_char(&mut self) -> Result<char, String> {
        let ch = self
            .rest()
            .chars()
            .next()
            .ok_or_else(|| "unexpected end of json".to_string())?;
        self.i += ch.len_utf8();
        Ok(ch)
    }
}

fn write_pretty(out: &mut String, value: &Json, indent: usize) {
    match value {
        Json::Null => out.push_str("null"),
        Json::Bool(true) => out.push_str("true"),
        Json::Bool(false) => out.push_str("false"),
        Json::Number(n) => out.push_str(n),
        Json::String(s) => out.push_str(&escape_string(s)),
        Json::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push_str("[\n");
            for (i, item) in items.iter().enumerate() {
                push_indent(out, indent + 1);
                write_pretty(out, item, indent + 1);
                if i + 1 != items.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            push_indent(out, indent);
            out.push(']');
        }
        Json::Object(pairs) => {
            if pairs.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push_str("{\n");
            for (i, (k, v)) in pairs.iter().enumerate() {
                push_indent(out, indent + 1);
                out.push_str(&escape_string(k));
                out.push_str(": ");
                write_pretty(out, v, indent + 1);
                if i + 1 != pairs.len() {
                    out.push(',');
                }
                out.push('\n');
            }
            push_indent(out, indent);
            out.push('}');
        }
    }
}

fn push_indent(out: &mut String, n: usize) {
    for _ in 0..n {
        out.push_str("  ");
    }
}

fn escape_string(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_object() {
        let raw = r#"{"b":1,"a":["x",true,null],"s":"hi\n"}"#;
        let value = parse(raw).unwrap();
        assert_eq!(value.get("a").and_then(|v| v.as_array()).unwrap().len(), 3);
        assert_eq!(value.get("s").and_then(|v| v.as_str()), Some("hi\n"));
        let pretty = value.to_pretty();
        let again = parse(&pretty).unwrap();
        assert_eq!(value, again);
    }
}
