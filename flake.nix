{
  description = "Bazaar — pinned dev toolchains for the monorepo";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in {
        devShells.default = pkgs.mkShell {
          # Matches repo tooling:
          #   Node 22 + npm 10.9.2 (CI, Dockerfile builder, packageManager)
          #   Bun (server dev/build/test; Dockerfile runtime)
          #   Pulumi + flyctl + cloudflared (infra / deploy / tunnel.sh)
          #   docker CLI (make docker-build), openssl + tsx (scripts/gen-did.sh)
          packages = with pkgs; [
            nodejs_22
            bun
            pulumi-bin
            flyctl
            cloudflared
            docker
            git
            gnumake
            openssl
            nodePackages.tsx
            cacert
          ];

          shellHook = ''
            if command -v corepack >/dev/null 2>&1; then
              corepack enable >/dev/null 2>&1 || true
              corepack prepare npm@10.9.2 --activate >/dev/null 2>&1 || true
            fi

            export NODE_EXTRA_CA_CERTS="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"

            echo "Bazaar dev shell"
            echo "  node $(node -v)  bun $(bun --version 2>/dev/null || echo n/a)  npm $(npm -v 2>/dev/null || echo n/a)"
            echo "  pulumi $(pulumi version 2>/dev/null | head -1 || echo n/a)"
            echo "  flyctl $(flyctl version 2>/dev/null | head -1 || echo n/a)"
            echo "  cloudflared $(cloudflared --version 2>/dev/null | head -1 || echo n/a)"
          '';
        };
      });
}
