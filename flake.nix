{
  description = "UEC native Linux desktop app and development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      version = "0.1.0";
    in {
      devShells = nixpkgs.lib.genAttrs systems (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            packages = with pkgs; [ nodejs_22 pnpm rustc cargo pkg-config gobject-introspection cargo-tauri patchelf fuse ];
            buildInputs = with pkgs; [ at-spi2-atk atkmm cairo gdk-pixbuf glib gtk3 harfbuzz librsvg libsoup_3 pango webkitgtk_4_1 openssl ];
            shellHook = ''
              export PKG_CONFIG_PATH="${pkgs.lib.makeSearchPath "lib/pkgconfig" (with pkgs; [ gtk3 webkitgtk_4_1 openssl ])}:$PKG_CONFIG_PATH"
              export APPIMAGE_EXTRACT_AND_RUN=1
            '';
          };
        });

      packages = nixpkgs.lib.genAttrs systems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          guiPackages = with pkgs; [ at-spi2-atk atkmm cairo gdk-pixbuf glib gtk3 harfbuzz librsvg libsoup_3 pango webkitgtk_4_1 openssl ];
        in {
          default = self.packages.${system}.uec;

          # NixOS-native build: no .deb/.AppImage packaging, just the wrapped
          # application binary, desktop entry and icon in the Nix store.
          uec = pkgs.stdenv.mkDerivation {
            pname = "uec";
            inherit version;
            src = self;

            # npm and cargo resolve their dependencies during the build.
            # On NixOS use `nix build --option sandbox false` (or add this
            # flake's builder to trusted-users) to allow those downloads.
            __noChroot = true;

            nativeBuildInputs = with pkgs; [
              pkg-config
              nodejs_22
              pnpm
              rustc
              cargo
              wrapGAppsHook3
              makeWrapper
            ];
            buildInputs = guiPackages;

            PKG_CONFIG_PATH = pkgs.lib.makeSearchPath "lib/pkgconfig" guiPackages;

            buildPhase = ''
              runHook preBuild
              export HOME="$TMPDIR"
              export XDG_CACHE_HOME="$TMPDIR/.cache"
              export CARGO_HOME="$TMPDIR/.cargo"
              corepack enable
              corepack pnpm config set store-dir "$TMPDIR/.pnpm-store"
              corepack pnpm install --frozen-lockfile
              corepack pnpm exec expo export --platform web
              corepack pnpm exec tauri build --no-bundle
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              install -Dm755 src-tauri/target/release/app $out/bin/uec
              install -Dm644 src-tauri/uec.desktop $out/share/applications/uec.desktop
              install -Dm644 src-tauri/icons/icon.png $out/share/icons/hicolor/512x512/apps/uec.png
              runHook postInstall
            '';

            meta = with pkgs.lib; {
              description = "UEC — Ultimate Email Client";
              homepage = "https://github.com/noa-santo/uec";
              license = licenses.unfree;
              mainProgram = "uec";
              platforms = platforms.linux;
            };
          };
        });

      apps = nixpkgs.lib.genAttrs systems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.uec}/bin/uec";
        };
      });

      checks = nixpkgs.lib.genAttrs systems (system: {
        default = self.devShells.${system}.default;
      });
    };
}
