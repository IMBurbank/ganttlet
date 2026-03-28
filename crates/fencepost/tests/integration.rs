use fencepost::{check_bash, check_edit, find_project_root, ProjectContext};

#[test]
fn integration_nested_repo_isolates_child() {
    let tmp = tempfile::tempdir().unwrap();
    // Parent repo
    std::fs::create_dir_all(tmp.path().join(".git")).unwrap();
    // Child repo (services/api)
    let child = tmp.path().join("services/api");
    std::fs::create_dir_all(child.join(".git")).unwrap();
    std::fs::create_dir_all(child.join("src")).unwrap();

    // Detect from child
    let root = find_project_root(&child).unwrap();
    assert_eq!(root, child);

    let ctx = ProjectContext::from_root_and_cwd(root.clone(), child.join("src"));

    // Child's .env is protected
    let child_env = format!("{}/.env", child.display());
    assert!(check_edit(&ctx, &child_env).is_some());

    // Parent's file is NOT protected (outside child's root)
    let parent_file = format!("{}/README.md", tmp.path().display());
    assert!(check_edit(&ctx, &parent_file).is_none());
}

#[test]
fn integration_nested_repo_parent_unaffected() {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(tmp.path().join(".git")).unwrap();
    let child = tmp.path().join("services/api");
    std::fs::create_dir_all(child.join(".git")).unwrap();

    // Detect from parent
    let root = find_project_root(tmp.path()).unwrap();
    assert_eq!(root, tmp.path().to_path_buf());

    let ctx = ProjectContext::from_root_and_cwd(root, tmp.path().to_path_buf());

    // Parent's .env is protected
    let parent_env = format!("{}/.env", tmp.path().display());
    assert!(check_edit(&ctx, &parent_env).is_some());

    // Child's src file is also protected (under parent's root)
    let child_file = format!("{}/src/main.rs", child.display());
    assert!(check_edit(&ctx, &child_file).is_some());
}

#[test]
fn integration_worktree_detects_real_root() {
    let tmp = tempfile::tempdir().unwrap();
    // Main repo
    let main_repo = tmp.path().join("main");
    std::fs::create_dir_all(main_repo.join(".git/worktrees/wt")).unwrap();
    // Worktree with .git file
    let wt = tmp.path().join("wt");
    std::fs::create_dir_all(wt.join("src")).unwrap();
    std::fs::write(wt.join(".git"), "gitdir: ../main/.git/worktrees/wt\n").unwrap();

    // Detect from worktree
    let root = find_project_root(&wt).unwrap();
    assert_eq!(root, main_repo);

    let wt_dir = root.join(".claude/worktrees");
    let ctx = ProjectContext::from_root_and_cwd(root.clone(), wt.join("src"));

    // File in main repo root is protected
    let main_file = format!("{}/src/app.ts", main_repo.display());
    assert!(check_edit(&ctx, &main_file).is_some());

    // File under the worktrees dir would be allowed (if it existed)
    let wt_file = format!("{}/wt/src/app.ts", wt_dir.display());
    assert!(check_edit(&ctx, &wt_file).is_none());
}

#[test]
fn integration_worktree_check_bash_push() {
    let tmp = tempfile::tempdir().unwrap();
    let main_repo = tmp.path().join("main");
    std::fs::create_dir_all(main_repo.join(".git/worktrees/wt")).unwrap();
    let wt = tmp.path().join("wt");
    std::fs::create_dir_all(&wt).unwrap();
    std::fs::write(wt.join(".git"), "gitdir: ../main/.git/worktrees/wt\n").unwrap();

    let root = find_project_root(&wt).unwrap();
    let ctx = ProjectContext::from_root_and_cwd(root, wt.clone());

    // push to main is blocked (uses default_branch from context)
    assert!(check_bash(&ctx, "git push origin main").is_some());

    // push to feature is allowed
    assert!(check_bash(&ctx, "git push origin feature-branch").is_none());
}

#[test]
fn integration_monorepo_single_root() {
    let tmp = tempfile::tempdir().unwrap();
    // Single repo with multiple packages
    std::fs::create_dir_all(tmp.path().join(".git")).unwrap();
    std::fs::create_dir_all(tmp.path().join("packages/api/src")).unwrap();
    std::fs::create_dir_all(tmp.path().join("packages/web/src")).unwrap();

    // Detect from packages/api/src — should find repo root, not package dir
    let root = find_project_root(&tmp.path().join("packages/api/src")).unwrap();
    assert_eq!(root, tmp.path().to_path_buf());

    let ctx = ProjectContext::from_root_and_cwd(root, tmp.path().join("packages/api/src"));

    // Both packages are under the same root — both protected
    let api_file = format!("{}/packages/api/src/main.ts", tmp.path().display());
    assert!(check_edit(&ctx, &api_file).is_some());

    let web_file = format!("{}/packages/web/src/app.ts", tmp.path().display());
    assert!(check_edit(&ctx, &web_file).is_some());

    // .env at repo root is protected
    let env_file = format!("{}/.env", tmp.path().display());
    assert!(check_edit(&ctx, &env_file).is_some());
}
