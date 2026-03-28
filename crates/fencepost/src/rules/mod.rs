//! Rule implementations for fencepost.
//!
//! Each check is a named struct implementing `BashRule` or `EditRule`.
//! Rules are independently testable and discoverable via the registries.

mod branch;
mod checkout;
mod clean;
mod cwd_enforcement;
mod interpreter;
mod protected_file;
mod push;
mod redirect;
mod reset;
mod rm_worktree;
mod sed_tee;
mod workspace_isolation;
mod worktree_remove;

pub use branch::BranchForceDelete;
pub use checkout::CheckoutSwitch;
pub use clean::CleanForce;
pub use cwd_enforcement::CwdEnforcement;
pub use interpreter::InterpreterWrite;
pub use protected_file::ProtectedFilePattern;
pub use push::PushToDefaultBranch;
pub use redirect::RedirectToProtectedPath;
pub use reset::ResetHard;
pub use rm_worktree::RmWorktreeRoot;
pub use sed_tee::SedTeeProtectedPath;
pub use workspace_isolation::WorkspaceIsolation;
pub use worktree_remove::WorktreeRemove;

use crate::{BashRule, EditRule};

/// All registered bash rules, checked in order against each segment.
pub static BASH_RULES: &[&(dyn BashRule + Sync)] = &[
    &PushToDefaultBranch,
    &CheckoutSwitch,
    &ResetHard,
    &CleanForce,
    &BranchForceDelete,
    &WorktreeRemove,
    &RmWorktreeRoot,
    &SedTeeProtectedPath,
    &InterpreterWrite,
    &RedirectToProtectedPath,
];

/// All registered edit rules, checked in order against each file path.
pub static EDIT_RULES: &[&(dyn EditRule + Sync)] =
    &[&ProtectedFilePattern, &WorkspaceIsolation, &CwdEnforcement];
