use std::env;

use schemars::JsonSchema;
use serde::Deserialize;
use zed::settings::ContextServerSettings;
use zed_extension_api::{
    self as zed, serde_json, Command, ContextServerConfiguration, ContextServerId, Project, Result,
};

const PACKAGE_NAME: &str = "@testingbot/mcp-server";
const SERVER_PATH: &str = "node_modules/@testingbot/mcp-server/dist/index.js";

struct TestingBotContextServerExtension;

/// Both fields are optional. Without them the server starts anyway and the
/// agent signs in with the `tb_login` tool, which opens a browser sign-in and
/// saves the credentials in ~/.testingbot/credentials.
#[derive(Debug, Default, Deserialize, JsonSchema)]
struct TestingBotContextServerSettings {
    /// TestingBot API key (https://testingbot.com/members/user/security)
    #[serde(default)]
    testingbot_key: Option<String>,
    /// TestingBot API secret
    #[serde(default)]
    testingbot_secret: Option<String>,
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty() && v != "YOUR_KEY" && v != "YOUR_SECRET")
}

impl zed::Extension for TestingBotContextServerExtension {
    fn new() -> Self {
        Self
    }

    fn context_server_command(
        &mut self,
        _context_server_id: &ContextServerId,
        project: &Project,
    ) -> Result<Command> {
        let latest_version = zed::npm_package_latest_version(PACKAGE_NAME)?;
        let installed_version = zed::npm_package_installed_version(PACKAGE_NAME)?;
        if installed_version.as_deref() != Some(latest_version.as_ref()) {
            zed::npm_install_package(PACKAGE_NAME, &latest_version)?;
        }

        let settings = ContextServerSettings::for_project("mcp-server-testingbot", project)?;
        let settings: TestingBotContextServerSettings = match settings.settings {
            Some(value) => serde_json::from_value(value).map_err(|e| e.to_string())?,
            None => TestingBotContextServerSettings::default(),
        };

        let mut env_vars = Vec::new();
        if let (Some(key), Some(secret)) = (
            non_empty(settings.testingbot_key),
            non_empty(settings.testingbot_secret),
        ) {
            env_vars.push(("TESTINGBOT_KEY".to_string(), key));
            env_vars.push(("TESTINGBOT_SECRET".to_string(), secret));
        }

        let server_path = env::current_dir()
            .map_err(|e| e.to_string())?
            .join(SERVER_PATH)
            .to_string_lossy()
            .to_string();

        Ok(Command {
            command: zed::node_binary_path()?,
            args: vec![server_path],
            env: env_vars,
        })
    }

    fn context_server_configuration(
        &mut self,
        _context_server_id: &ContextServerId,
        _project: &Project,
    ) -> Result<Option<ContextServerConfiguration>> {
        let installation_instructions =
            include_str!("../configuration/installation_instructions.md").to_string();
        let default_settings = include_str!("../configuration/default_settings.jsonc").to_string();
        let settings_schema =
            serde_json::to_string(&schemars::schema_for!(TestingBotContextServerSettings))
                .map_err(|e| e.to_string())?;

        Ok(Some(ContextServerConfiguration {
            installation_instructions,
            default_settings,
            settings_schema,
        }))
    }
}

zed::register_extension!(TestingBotContextServerExtension);
