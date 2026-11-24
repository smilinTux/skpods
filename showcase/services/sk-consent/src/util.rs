use chrono::{DateTime, Utc};

/// Parse "90s", "30m", "24h", "3d", "PT24H", "P1D", "PT1H30M" or bare seconds into seconds.
pub fn parse_duration(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    if let Ok(n) = s.parse::<i64>() {
        return (n > 0).then_some(n);
    }
    let up = s.to_ascii_uppercase();
    if up.starts_with('P') {
        return parse_iso(&up);
    }
    let (num, unit) = s.split_at(s.len() - 1);
    let n: i64 = num.trim().parse().ok()?;
    let mult = match unit {
        "s" => 1,
        "m" => 60,
        "h" => 3600,
        "d" => 86400,
        "w" => 7 * 86400,
        _ => return None,
    };
    (n > 0).then_some(n * mult)
}

fn parse_iso(s: &str) -> Option<i64> {
    let body = &s[1..];
    let mut total = 0i64;
    let mut in_time = false;
    let mut num = String::new();
    for ch in body.chars() {
        match ch {
            'T' => in_time = true,
            '0'..='9' => num.push(ch),
            _ => {
                let n: i64 = num.parse().ok()?;
                num.clear();
                total += n * match (ch, in_time) {
                    ('W', false) => 7 * 86400,
                    ('D', false) => 86400,
                    ('H', true) => 3600,
                    ('M', true) => 60,
                    ('S', true) => 1,
                    _ => return None,
                };
            }
        }
    }
    (num.is_empty() && total > 0).then_some(total)
}

/// ISO 8601 duration text for seconds, e.g. 259200 -> "PT72H".
pub fn iso_duration(secs: i64) -> String {
    if secs % 3600 == 0 {
        format!("PT{}H", secs / 3600)
    } else if secs % 60 == 0 {
        format!("PT{}M", secs / 60)
    } else {
        format!("PT{}S", secs)
    }
}

/// Short human text, e.g. 259200 -> "72 hours".
pub fn human_duration(secs: i64) -> String {
    let (n, unit) = if secs % 86400 == 0 && secs >= 86400 {
        (secs / 86400, "day")
    } else if secs % 3600 == 0 && secs >= 3600 {
        (secs / 3600, "hour")
    } else if secs % 60 == 0 && secs >= 60 {
        (secs / 60, "minute")
    } else {
        (secs, "second")
    };
    format!("{} {}{}", n, unit, if n == 1 { "" } else { "s" })
}

pub fn now() -> DateTime<Utc> {
    Utc::now()
}

pub fn ts(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Escape a string for a Turtle double-quoted literal.
pub fn ttl_lit(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('"');
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

/// Make sure an IRI is safe to put inside <...> in Turtle.
pub fn ttl_iri(s: &str) -> String {
    let clean: String = s
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '<' | '>' | '"' | ' ' | '{' | '}' | '|' | '\\' | '^' | '`'))
        .collect();
    format!("<{}>", clean)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn durations() {
        assert_eq!(parse_duration("24h"), Some(86400));
        assert_eq!(parse_duration("72h"), Some(259200));
        assert_eq!(parse_duration("20s"), Some(20));
        assert_eq!(parse_duration("PT1H30M"), Some(5400));
        assert_eq!(parse_duration("P1D"), Some(86400));
        assert_eq!(parse_duration("45"), Some(45));
        assert_eq!(parse_duration("0h"), None);
        assert_eq!(parse_duration("soon"), None);
        assert_eq!(iso_duration(259200), "PT72H");
        assert_eq!(human_duration(259200), "3 days");
        assert_eq!(human_duration(86400), "1 day");
    }
}
