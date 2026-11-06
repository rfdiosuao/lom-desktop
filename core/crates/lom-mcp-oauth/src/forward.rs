use crate::{Error, OAuthClient, Result};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

/// Stateless HTTP MCP → stdio adapter. Refreshes credentials before each POST;
/// never retries a tool call after sending it, including on a 401 or timeout.
/// Scope: Streamable HTTP POST responses (JSON or SSE); not legacy SSE GET push.
pub async fn run_stdio(user: &str, resource: &str) -> Result<()> {
    let client = OAuthClient::desktop()?;
    pipe(
        &client,
        user,
        resource,
        BufReader::new(tokio::io::stdin()),
        tokio::io::stdout(),
    )
    .await
}
pub(crate) async fn pipe<R: tokio::io::AsyncBufRead + Unpin, W: tokio::io::AsyncWrite + Unpin>(
    client: &OAuthClient,
    user: &str,
    resource: &str,
    mut input: R,
    mut output: W,
) -> Result<()> {
    let mut session = WireState::default();
    loop {
        let mut line = String::new();
        let n = (&mut input)
            .take(1_048_577)
            .read_line(&mut line)
            .await
            .map_err(|_| Error("mcp.oauth.stdin"))?;
        if n == 0 {
            return Ok(());
        }
        if n > 1_048_576 {
            return Err(Error("mcp.oauth.request_too_large"));
        }
        let body: Value = serde_json::from_str(&line).map_err(|_| Error("mcp.oauth.invalid_rpc"))?;
        match client.forward(user, resource, &body, &mut session).await {
            Ok(messages) => {
                for message in messages {
                    write(&mut output, &message).await?;
                }
            }
            Err(e) => {
                if let Some(id) = body.get("id") {
                    write(
                        &mut output,
                        &json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":e.0}}),
                    )
                    .await?;
                } else {
                    return Err(e);
                }
            }
        }
    }
}
async fn write<W: tokio::io::AsyncWrite + Unpin>(out: &mut W, value: &Value) -> Result<()> {
    let line = serde_json::to_string(value).map_err(|_| Error("mcp.oauth.invalid_rpc"))? + "\n";
    out.write_all(line.as_bytes())
        .await
        .map_err(|_| Error("mcp.oauth.stdout"))?;
    out.flush().await.map_err(|_| Error("mcp.oauth.stdout"))
}
#[derive(Default)]
pub struct WireState {
    pub session_id: Option<String>,
    pub protocol_version: Option<String>,
}
impl OAuthClient {
    pub async fn forward(
        &self,
        user: &str,
        resource: &str,
        body: &Value,
        session: &mut WireState,
    ) -> Result<Vec<Value>> {
        let token = self.token(user, resource).await?;
        let mut request = self
            .http
            .post(resource)
            .bearer_auth(token)
            .header("Accept", "application/json, text/event-stream")
            .json(body)
            .timeout(std::time::Duration::from_secs(300));
        if let Some(protocol) = &session.protocol_version {
            request = request.header("MCP-Protocol-Version", protocol);
        }
        if let Some(id) = &session.session_id {
            request = request.header("Mcp-Session-Id", id);
        }
        let mut response = request.send().await.map_err(|_| Error("mcp.oauth.outcome_unknown"))?;
        if response.status().as_u16() == 401 {
            return Err(Error("mcp.oauth.login_required"));
        }
        if !response.status().is_success() {
            return Err(Error("mcp.oauth.outcome_unknown"));
        }
        if let Some(value) = response.headers().get("mcp-session-id") {
            session.session_id = Some(
                value
                    .to_str()
                    .map_err(|_| Error("mcp.oauth.invalid_response"))?
                    .to_owned(),
            );
        }
        if response.status().as_u16() == 204 || response.status().as_u16() == 202 {
            return Ok(vec![]);
        }
        let sse = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("text/event-stream"));
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Error("mcp.oauth.outcome_unknown"))? {
            if bytes.len() + chunk.len() > 16 * 1024 * 1024 {
                return Err(Error("mcp.oauth.response_too_large"));
            }
            bytes.extend_from_slice(&chunk);
        }
        let messages = if sse {
            parse_sse(&bytes)?
        } else {
            vec![serde_json::from_slice(&bytes).map_err(|_| Error("mcp.oauth.invalid_response"))?]
        };
        if body["method"] == "initialize" {
            session.protocol_version = messages
                .iter()
                .find_map(|v| v["result"]["protocolVersion"].as_str())
                .map(str::to_owned);
        }
        Ok(messages)
    }
}
fn parse_sse(bytes: &[u8]) -> Result<Vec<Value>> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| Error("mcp.oauth.invalid_response"))?
        .replace("\r\n", "\n");
    let mut messages = Vec::new();
    for event in text.split("\n\n") {
        let data = event
            .lines()
            .filter_map(|l| l.strip_prefix("data:").map(|v| v.strip_prefix(' ').unwrap_or(v)))
            .collect::<Vec<_>>()
            .join("\n");
        if !data.is_empty() {
            messages.push(serde_json::from_str(&data).map_err(|_| Error("mcp.oauth.invalid_response"))?);
        }
    }
    Ok(messages)
}
