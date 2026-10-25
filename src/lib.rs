#![forbid(unsafe_code)]

pub mod artifact;
pub mod claims;
pub mod diff;
pub mod extract;
pub mod finding;
pub mod hashutil;
pub mod inventory;
pub mod jsonutil;
pub mod manifest;
pub mod report;
pub mod review;
pub mod rules;

pub use finding::{Finding, Severity};
pub use review::{Review, ReviewRequest, Verdict};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
