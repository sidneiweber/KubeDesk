#!/usr/bin/env bash
# Assina os .rpm de um diretório e exporta a chave pública ao lado deles.
#
#   RPM_GPG_PRIVATE_KEY=... [RPM_GPG_PASSPHRASE=...] scripts/sign-rpm.sh dist
#
# Sem assinatura, o rpm 6 (Fedora 43+) recusa instalar o pacote: a
# verificação padrão passou a ser "all". Roda no runner Ubuntu do workflow
# Release; precisa de gpg e rpmsign (pacote "rpm").
set -euo pipefail

dir=${1:?uso: sign-rpm.sh <diretório com os .rpm>}
: "${RPM_GPG_PRIVATE_KEY:?secret RPM_GPG_PRIVATE_KEY não configurado (veja "Assinatura do RPM" no README)}"

shopt -s nullglob
rpms=("$dir"/*.rpm)
if [ ${#rpms[@]} -eq 0 ]; then
  echo "Nenhum .rpm em $dir" >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Chaveiro próprio, descartado no fim: a chave privada não fica no runner
export GNUPGHOME="$tmp/gnupg"
mkdir -m 700 "$GNUPGHOME"
printf '%s\n' "$RPM_GPG_PRIVATE_KEY" | gpg --batch --quiet --import
key_id=$(gpg --list-secret-keys --with-colons | awk -F: '/^sec/ { print $5; exit }')

# Passphrase por arquivo, nunca na linha de comando (apareceria no ps)
pass_file="$tmp/passphrase"
printf '%s' "${RPM_GPG_PASSPHRASE:-}" > "$pass_file"

# __gpg: o rpm do Ubuntu procura o gpg em outro caminho
rpmsign --addsign \
  --define "__gpg $(command -v gpg)" \
  --define "_gpg_name $key_id" \
  --define "_gpg_path $GNUPGHOME" \
  --define "_gpg_sign_cmd_extra_args --batch --pinentry-mode loopback --passphrase-file $pass_file" \
  "${rpms[@]}"

pubkey="$dir/RPM-GPG-KEY-kubedesk.asc"
gpg --armor --export "$key_id" > "$pubkey"

# Confere como quem for instalar: só com a chave pública importada
mkdir "$tmp/rpmdb"
rpmkeys --dbpath "$tmp/rpmdb" --import "$pubkey"
rpmkeys --dbpath "$tmp/rpmdb" --checksig "${rpms[@]}"
echo "Assinados com a chave $key_id: ${rpms[*]}"
