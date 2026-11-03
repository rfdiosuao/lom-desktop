use super::*;
#[test]
fn local_file_01_unknown_and_expired_grants_are_rejected() {
    let mut grants = Grants::default();
    assert!(grants.chunk("arbitrary-path-or-ticket", 0).is_err());
    let file = File::open(file!()).unwrap();
    let (_, _, ticket) = grants.insert(file).unwrap();
    grants.entries.get_mut(&ticket).unwrap().used = Instant::now() - TTL;
    assert!(grants.chunk(&ticket, 0).is_err());
}
#[test]
fn local_file_01_replacing_path_cannot_redirect_an_existing_grant() {
    let root = std::env::temp_dir().join(format!("lom-grant-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let path = root.join("approved.txt");
    std::fs::write(&path, b"approved").unwrap();
    let (_, file) = requested(path.to_str().unwrap()).unwrap();
    let mut grants = Grants::default();
    let (_, _, ticket) = grants.insert(file).unwrap();
    std::fs::rename(&path, root.join("original.txt")).unwrap();
    std::fs::write(&path, b"different").unwrap();
    assert_eq!(
        STANDARD.decode(grants.chunk(&ticket, 0).unwrap()).unwrap(),
        b"approved"
    );
    drop(grants);
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn local_file_01_limits_open_grants_and_never_accepts_relative_paths() {
    assert!(requested("relative.txt").is_err());
    let mut grants = Grants::default();
    for _ in 0..8 {
        grants.insert(File::open(file!()).unwrap()).unwrap();
    }
    assert!(grants.insert(File::open(file!()).unwrap()).is_err());
}
#[test]
fn local_file_01_ticket_reads_only_approved_open_file_and_checks_offset() {
    let file = File::open(file!()).unwrap();
    let mut grants = Grants::default();
    let (size, _, ticket) = grants.insert(file).unwrap();
    assert!(!grants.chunk(&ticket, 0).unwrap().is_empty());
    assert!(grants
        .chunk(&ticket, size.parse::<u64>().unwrap() + 1)
        .is_err());
    grants.entries.remove(&ticket);
    assert!(grants.chunk(&ticket, 0).is_err());
}
