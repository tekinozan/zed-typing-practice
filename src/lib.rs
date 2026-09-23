use std::fs;
use zed_extension_api::{self as zed, serde_json, settings::LspSettings, LanguageServerId, Result};

/// npm'de yayınlanırsa kullanılacak paket adı.
const SERVER_PACKAGE: &str = "zed-typing-lsp";
/// `npm link` ile PATH'e eklenen komut adı (geliştirme sırasında).
const SERVER_BIN: &str = "typing-lsp";
const SERVER_PATH: &str = "node_modules/zed-typing-lsp/dist/server.js";

struct TypingExtension {
    did_install: bool,
}

impl TypingExtension {
    fn npm_server_path(&mut self, id: &LanguageServerId) -> Result<String> {
        let exists = fs::metadata(SERVER_PATH).is_ok_and(|m| m.is_file());
        if self.did_install && exists {
            return Ok(SERVER_PATH.to_string());
        }

        zed::set_language_server_installation_status(
            id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );
        let latest = match zed::npm_package_latest_version(SERVER_PACKAGE) {
            Ok(version) => version,
            Err(_) if exists => {
                self.did_install = true;
                return Ok(SERVER_PATH.to_string());
            }
            Err(err) => return Err(err),
        };
        let installed = zed::npm_package_installed_version(SERVER_PACKAGE)?;

        if !exists || installed.as_deref() != Some(latest.as_str()) {
            zed::set_language_server_installation_status(
                id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            if let Err(err) = zed::npm_install_package(SERVER_PACKAGE, &latest) {
                if !exists {
                    return Err(err);
                }
            }
        }

        self.did_install = true;
        Ok(SERVER_PATH.to_string())
    }
}

impl zed::Extension for TypingExtension {
    fn new() -> Self {
        Self { did_install: false }
    }

    fn language_server_command(
        &mut self,
        id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        // 1) settings.json → "lsp": { "typing-lsp": { "binary": { "path": ... } } }
        if let Ok(settings) = LspSettings::for_worktree(id.as_ref(), worktree) {
            if let Some(binary) = settings.binary {
                if let Some(path) = binary.path {
                    return Ok(zed::Command {
                        command: path,
                        args: binary.arguments.unwrap_or_else(|| vec!["--stdio".into()]),
                        env: binary.env.unwrap_or_default().into_iter().collect(),
                    });
                }
            }
        }

        // 2) PATH üzerinde `typing-lsp` (geliştirirken `npm link` ile)
        if let Some(path) = worktree.which(SERVER_BIN) {
            return Ok(zed::Command {
                command: path,
                args: vec!["--stdio".into()],
                env: worktree.shell_env(),
            });
        }

        // 3) npm'den otomatik kurulum (paket yayınlandıysa)
        let server_path = self.npm_server_path(id)?;
        let full_path = std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(server_path);

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![full_path.to_string_lossy().into_owned(), "--stdio".into()],
            env: Default::default(),
        })
    }

    fn language_server_initialization_options(
        &mut self,
        id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        Ok(LspSettings::for_worktree(id.as_ref(), worktree)
            .ok()
            .and_then(|s| s.initialization_options))
    }

    fn language_server_workspace_configuration(
        &mut self,
        id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<serde_json::Value>> {
        Ok(LspSettings::for_worktree(id.as_ref(), worktree)
            .ok()
            .and_then(|s| s.settings))
    }
}

zed::register_extension!(TypingExtension);
