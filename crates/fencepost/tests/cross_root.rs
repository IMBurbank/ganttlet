use fencepost::{check_bash, check_edit, ProjectContext};
use std::path::PathBuf;

fn alt_ctx() -> ProjectContext {
    ProjectContext::from_root_and_cwd(
        PathBuf::from("/home/user/myproject"),
        PathBuf::from("/home/user/myproject/.claude/worktrees/wt"),
    )
    .with_default_branch("develop")
    .with_remote_name("upstream")
}

fn alt_ctx_at_root() -> ProjectContext {
    ProjectContext::from_root_and_cwd(
        PathBuf::from("/home/user/myproject"),
        PathBuf::from("/home/user/myproject"),
    )
    .with_default_branch("develop")
    .with_remote_name("upstream")
}

// -- check_edit with alt root --

#[test]
fn cross_edit_blocks_alt_root_file() {
    assert!(check_edit(&alt_ctx(), "/home/user/myproject/src/foo.ts").is_some());
}

#[test]
fn cross_edit_allows_alt_worktree_file() {
    assert!(check_edit(
        &alt_ctx(),
        "/home/user/myproject/.claude/worktrees/wt/src/foo.ts"
    )
    .is_none());
}

#[test]
fn cross_edit_allows_default_root_with_alt_ctx() {
    // /workspace/ is NOT protected under alt_ctx — it's a different project
    assert!(check_edit(&alt_ctx(), "/workspace/src/foo.ts").is_none());
}

#[test]
fn cross_edit_blocks_protected_file_alt_root() {
    assert!(check_edit(&alt_ctx(), "/home/user/myproject/package-lock.json").is_some());
}

#[test]
fn cross_edit_blocks_env_alt_root() {
    assert!(check_edit(&alt_ctx(), "/home/user/myproject/.env.production").is_some());
}

// -- check_bash push with alt branch --

#[test]
fn cross_bash_blocks_push_to_develop() {
    assert!(check_bash(&alt_ctx(), "git push upstream develop").is_some());
}

#[test]
fn cross_bash_allows_push_to_main_with_alt_ctx() {
    // "main" is NOT the default branch in alt_ctx — push allowed
    assert!(check_bash(&alt_ctx(), "git push upstream main").is_none());
}

#[test]
fn cross_bash_blocks_push_head_to_develop() {
    assert!(check_bash(&alt_ctx(), "git push upstream HEAD:develop").is_some());
}

#[test]
fn cross_bash_blocks_push_refs_heads_develop() {
    assert!(check_bash(&alt_ctx(), "git push upstream feature:refs/heads/develop").is_some());
}

#[test]
fn cross_bash_allows_push_feature() {
    assert!(check_bash(&alt_ctx(), "git push upstream feature-branch").is_none());
}

// -- check_bash reset with alt remote --

#[test]
fn cross_bash_reset_hard_warns_without_upstream() {
    // In alt_ctx, "upstream/" is required, not "origin/"
    assert!(check_bash(&alt_ctx(), "git reset --hard HEAD~1").is_some());
}

#[test]
fn cross_bash_reset_hard_allows_upstream_ref() {
    // Only blocked if CWD is project root — since we're not at /home/user/myproject, allow
    assert!(check_bash(&alt_ctx(), "git reset --hard upstream/develop").is_none());
}

#[test]
fn cross_bash_reset_hard_warns_origin_ref_with_alt_ctx() {
    // "origin/" is NOT the configured remote in alt_ctx
    assert!(check_bash(&alt_ctx(), "git reset --hard origin/main").is_some());
}

// -- redirect with alt root --

#[test]
fn cross_bash_redirect_blocks_alt_root() {
    assert!(check_bash(&alt_ctx(), "echo hello > /home/user/myproject/file.txt").is_some());
}

#[test]
fn cross_bash_redirect_allows_alt_worktree() {
    assert!(check_bash(
        &alt_ctx(),
        "echo hello > /home/user/myproject/.claude/worktrees/wt/file.txt"
    )
    .is_none());
}

#[test]
fn cross_bash_redirect_allows_default_root_with_alt_ctx() {
    // /workspace/ is NOT protected under alt_ctx
    assert!(check_bash(&alt_ctx(), "echo hello > /workspace/file.txt").is_none());
}

// -- sed/tee with alt root --

#[test]
fn cross_bash_sed_blocks_alt_root() {
    assert!(check_bash(&alt_ctx(), "sed -i s/x/y/ /home/user/myproject/src/file.ts").is_some());
}

#[test]
fn cross_bash_tee_blocks_alt_root() {
    assert!(check_bash(&alt_ctx(), "echo hello | tee /home/user/myproject/out.txt").is_some());
}

// -- interpreter with alt root --

#[test]
fn cross_bash_interpreter_blocks_alt_root() {
    assert!(check_bash(
        &alt_ctx(),
        "python3 -c \"import os; os.system('rm /home/user/myproject/file')\""
    )
    .is_some());
}

#[test]
fn cross_bash_interpreter_allows_alt_worktree() {
    assert!(check_bash(
        &alt_ctx(),
        "python3 -c \"import os; os.system('rm /home/user/myproject/.claude/worktrees/wt/file')\""
    )
    .is_none());
}

// -- worktree-remove with alt root --

#[test]
fn cross_bash_rm_worktree_blocks_alt_root() {
    assert!(check_bash(
        &alt_ctx(),
        "rm -rf /home/user/myproject/.claude/worktrees/my-wt"
    )
    .is_some());
}

// -- block messages reference correct paths --

#[test]
fn cross_block_message_contains_alt_root() {
    let msg = check_bash(&alt_ctx(), "echo hello > /home/user/myproject/file.txt").unwrap();
    assert!(
        msg.contains("/home/user/myproject"),
        "message should reference alt root: {}",
        msg
    );
}

#[test]
fn cross_push_message_contains_develop() {
    let msg = check_bash(&alt_ctx(), "git push upstream develop").unwrap();
    assert!(
        msg.contains("develop"),
        "message should reference alt branch: {}",
        msg
    );
}

// -- CWD-dependent checks with alt context at project root --

#[test]
fn cross_checkout_blocks_at_alt_root() {
    assert!(check_bash(&alt_ctx_at_root(), "git checkout develop").is_some());
}

#[test]
fn cross_checkout_allows_in_alt_worktree() {
    assert!(check_bash(&alt_ctx(), "git checkout develop").is_none());
}

#[test]
fn cross_switch_blocks_at_alt_root() {
    assert!(check_bash(&alt_ctx_at_root(), "git switch feature").is_some());
}

#[test]
fn cross_reset_hard_blocks_at_alt_root() {
    // Even with upstream/ ref, reset --hard is blocked at project root
    assert!(check_bash(&alt_ctx_at_root(), "git reset --hard upstream/develop").is_some());
}

#[test]
fn cross_clean_force_blocks_at_alt_root() {
    assert!(check_bash(&alt_ctx_at_root(), "git clean -fd").is_some());
}

#[test]
fn cross_clean_force_allows_in_alt_worktree() {
    assert!(check_bash(&alt_ctx(), "git clean -fd").is_none());
}

#[test]
fn cross_branch_d_blocks_at_alt_root() {
    assert!(check_bash(&alt_ctx_at_root(), "git branch -D feature").is_some());
}

#[test]
fn cross_branch_d_allows_in_alt_worktree() {
    assert!(check_bash(&alt_ctx(), "git branch -D feature").is_none());
}
