use oxrdf::{Subject, Term};

#[derive(Debug, Clone, PartialEq)]
pub struct Tr {
    pub s: String,
    pub p: String,
    /// IRI text or literal lexical value.
    pub o: String,
    pub o_is_iri: bool,
}

/// Parse Turtle into simple string triples. Parse errors yield what was read so far (lenient on purpose:
/// the engine's listings are plain Turtle, but a malformed user file must not take the broker down).
pub fn parse_turtle(text: &str, base: &str) -> Vec<Tr> {
    let parser = match oxttl::TurtleParser::new().with_base_iri(base) {
        Ok(p) => p,
        Err(_) => return vec![],
    };
    let mut out = vec![];
    for t in parser.for_slice(text.as_bytes()) {
        let Ok(t) = t else { break };
        let s = match &t.subject {
            Subject::NamedNode(n) => n.as_str().to_string(),
            Subject::BlankNode(b) => format!("_:{}", b.as_str()),
        };
        let (o, o_is_iri) = match &t.object {
            Term::NamedNode(n) => (n.as_str().to_string(), true),
            Term::BlankNode(b) => (format!("_:{}", b.as_str()), false),
            Term::Literal(l) => (l.value().to_string(), false),
        };
        out.push(Tr { s, p: t.predicate.as_str().to_string(), o, o_is_iri });
    }
    out
}

pub const LDP_CONTAINS: &str = "http://www.w3.org/ns/ldp#contains";
pub const PIM_STORAGE: &str = "http://www.w3.org/ns/pim/space#storage";

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_listing() {
        let t = "@prefix ldp: <http://www.w3.org/ns/ldp#>.\n<> a ldp:Container; ldp:contains <a.ttl>, <b/>.";
        let tr = parse_turtle(t, "https://h/x/");
        let c: Vec<_> = tr.iter().filter(|t| t.p == LDP_CONTAINS).map(|t| t.o.clone()).collect();
        assert_eq!(c, vec!["https://h/x/a.ttl", "https://h/x/b/"]);
    }
}
