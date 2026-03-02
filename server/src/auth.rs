use bytes::Bytes;
use http_body_util::{BodyExt, Empty};
use hyper::Request;
use hyper_rustls::HttpsConnectorBuilder;
use hyper_util::client::legacy::{connect::HttpConnector, Client};
use hyper_util::rt::TokioExecutor;
use serde::Deserialize;
use std::fmt;

/// Information about an authenticated Google user.
#[derive(Debug, Clone)]
pub struct UserInfo {
    pub email: String,
    pub name: String,
    pub picture: Option<String>,
}

/// The role a user has for a particular Google Drive file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriveRole {
    /// User can edit the file (Sheet owner or editor).
    Writer,
    /// User can view but not edit the file (Sheet viewer).
    Reader,
}

/// Errors that can occur during authentication or authorization.
#[derive(Debug)]
pub enum AuthError {
    /// The Google access token is invalid or expired.
    InvalidToken(String),
    /// The user does not have access to the requested file.
    NoAccess(String),
    /// A network or API error occurred.
    RequestFailed(String),
}

impl fmt::Display for AuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AuthError::InvalidToken(msg) => write!(f, "Invalid token: {}", msg),
            AuthError::NoAccess(msg) => write!(f, "No access: {}", msg),
            AuthError::RequestFailed(msg) => write!(f, "Request failed: {}", msg),
        }
    }
}

impl std::error::Error for AuthError {}

/// Response from Google's userinfo endpoint.
#[derive(Deserialize)]
struct GoogleUserInfo {
    email: Option<String>,
    name: Option<String>,
    picture: Option<String>,
}

/// Response from Google Drive files API with capabilities.
#[derive(Deserialize)]
struct DriveFileResponse {
    capabilities: Option<DriveCapabilities>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveCapabilities {
    can_edit: Option<bool>,
}

/// Build an HTTPS client using hyper + rustls.
fn https_client() -> Client<
    hyper_rustls::HttpsConnector<HttpConnector>,
    Empty<Bytes>,
> {
    let tls = HttpsConnectorBuilder::new()
        .with_webpki_roots()
        .https_only()
        .enable_http1()
        .build();
    Client::builder(TokioExecutor::new()).build(tls)
}

/// Validate a Google access token by calling the userinfo API.
///
/// Returns the authenticated user's information if the token is valid.
pub async fn validate_token(token: &str) -> Result<UserInfo, AuthError> {
    let client = https_client();

    let req = Request::get("https://www.googleapis.com/oauth2/v2/userinfo")
        .header("Authorization", format!("Bearer {}", token))
        .body(Empty::<Bytes>::new())
        .map_err(|e| AuthError::RequestFailed(format!("Failed to build request: {}", e)))?;

    let response = client
        .request(req)
        .await
        .map_err(|e| AuthError::RequestFailed(format!("Failed to call userinfo API: {}", e)))?;

    let status = response.status();

    if !status.is_success() {
        let body_bytes = response
            .into_body()
            .collect()
            .await
            .map(|b| b.to_bytes())
            .unwrap_or_default();
        let body = String::from_utf8_lossy(&body_bytes);
        return Err(AuthError::InvalidToken(format!(
            "Google userinfo returned {}: {}",
            status, body
        )));
    }

    let body_bytes = response
        .into_body()
        .collect()
        .await
        .map_err(|e| AuthError::RequestFailed(format!("Failed to read response body: {}", e)))?
        .to_bytes();

    let info: GoogleUserInfo = serde_json::from_slice(&body_bytes)
        .map_err(|e| AuthError::RequestFailed(format!("Failed to parse userinfo response: {}", e)))?;

    Ok(UserInfo {
        email: info.email.unwrap_or_default(),
        name: info.name.unwrap_or_else(|| "Unknown".to_string()),
        picture: info.picture,
    })
}

/// Check a user's Google Drive permissions for a specific file.
///
/// The `file_id` corresponds to the Google Sheet ID (which is also the room ID).
/// Returns the user's role (Writer or Reader) based on their Drive permissions.
pub async fn check_drive_permission(token: &str, file_id: &str) -> Result<DriveRole, AuthError> {
    let client = https_client();
    let url = format!(
        "https://www.googleapis.com/drive/v3/files/{}?fields=capabilities",
        file_id
    );

    let req = Request::get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .body(Empty::<Bytes>::new())
        .map_err(|e| AuthError::RequestFailed(format!("Failed to build request: {}", e)))?;

    let response = client
        .request(req)
        .await
        .map_err(|e| AuthError::RequestFailed(format!("Failed to call Drive API: {}", e)))?;

    let status = response.status();

    if status.as_u16() == 404 {
        return Err(AuthError::NoAccess(
            "File not found or no access".to_string(),
        ));
    }

    if status.as_u16() == 403 {
        return Err(AuthError::NoAccess(
            "Permission denied for this file".to_string(),
        ));
    }

    if !status.is_success() {
        let body_bytes = response
            .into_body()
            .collect()
            .await
            .map(|b| b.to_bytes())
            .unwrap_or_default();
        let body = String::from_utf8_lossy(&body_bytes);
        return Err(AuthError::RequestFailed(format!(
            "Drive API returned {}: {}",
            status, body
        )));
    }

    let body_bytes = response
        .into_body()
        .collect()
        .await
        .map_err(|e| AuthError::RequestFailed(format!("Failed to read response body: {}", e)))?
        .to_bytes();

    let file_info: DriveFileResponse = serde_json::from_slice(&body_bytes)
        .map_err(|e| AuthError::RequestFailed(format!("Failed to parse Drive response: {}", e)))?;

    let can_edit = file_info
        .capabilities
        .and_then(|c| c.can_edit)
        .unwrap_or(false);

    if can_edit {
        Ok(DriveRole::Writer)
    } else {
        Ok(DriveRole::Reader)
    }
}
