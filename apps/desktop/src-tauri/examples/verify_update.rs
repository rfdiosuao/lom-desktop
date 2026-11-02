//! Verify a release artifact using the same signature primitive as the updater.
use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use std::{error::Error, fs};
fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 {
        return Err("usage: verify_update <pubkey> <artifact> <signature> <version>".into());
    }
    let decode = |path: &str| -> Result<String, Box<dyn Error>> {
        Ok(String::from_utf8(
            base64::engine::general_purpose::STANDARD.decode(fs::read_to_string(path)?.trim())?,
        )?)
    };
    let key = PublicKey::decode(&decode(&args[1])?)?;
    let signature = Signature::decode(&decode(&args[3])?)?;
    let mut data = fs::read(&args[2])?;
    key.verify(&data, &signature, true)?;
    let version = signature
        .trusted_comment()
        .split_whitespace()
        .find_map(|part| part.strip_prefix("version:"));
    if version != Some(args[4].as_str()) {
        return Err("signed version does not match release".into());
    }
    if let Some(byte) = data.first_mut() {
        *byte ^= 1;
    }
    if key.verify(&data, &signature, true).is_ok() {
        return Err("tampered artifact accepted".into());
    }
    println!(
        "PASS: artifact signature, signed version {}, tamper rejection",
        args[4]
    );
    Ok(())
}
