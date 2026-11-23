{
  description = "UEC native Linux desktop app and development environment";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let systems = [ "x86_64-linux" "aarch64-linux" ];
    in {
      devShells = nixpkgs.lib.genAttrs systems (system:
        let pkgs = import nixpkgs { inherit system; };
        in { default = pkgs.mkShell {
          packages = with pkgs; [ nodejs_22 pnpm rustc cargo pkg-config gobject-introspection cargo-tauri patchelf fuse ];
          buildInputs = with pkgs; [ at-spi2-atk atkmm cairo gdk-pixbuf glib gtk3 harfbuzz librsvg libsoup_3 pango webkitgtk_4_1 openssl ];
          shellHook = ''export PKG_CONFIG_PATH="${pkgs.lib.makeSearchPath "lib/pkgconfig" (with pkgs; [ gtk3 webkitgtk_4_1 openssl ])}:$PKG_CONFIG_PATH"
            export APPIMAGE_EXTRACT_AND_RUN=1'';
        }; });
      packages = nixpkgs.lib.genAttrs systems (system:
        let pkgs = import nixpkgs { inherit system; };
        in { default = pkgs.writeShellApplication { name = "uec-build"; runtimeInputs = with pkgs; [ nodejs_22 pnpm cargo ]; text = ''
          corepack enable
          corepack pnpm install --frozen-lockfile
          corepack pnpm exec expo export --platform web
          corepack pnpm exec tauri build
        ''; }; });
      apps = nixpkgs.lib.genAttrs systems (system: { default = { type = "app"; program = "${self.packages.${system}.default}/bin/uec-build"; }; });
      checks = nixpkgs.lib.genAttrs systems (system: { default = self.devShells.${system}.default; });
    };
}
