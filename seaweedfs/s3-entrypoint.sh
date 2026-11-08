#!/bin/sh
# Production SeaweedFS entrypoint wrapper.
#
# Why: the S3 identity has to come from the deployment environment, not from a
# file committed to the repository. This script writes the config from the
# required S3_ACCESS_KEY and S3_SECRET_KEY values, then hands control to the
# image's own entrypoint so its /data permission fix and user switch still run.
#
# Used by: compose.yaml (production only). Development mounts s3.json instead.
set -eu

: "${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
: "${S3_SECRET_KEY:?S3_SECRET_KEY is required}"

# The values are written into JSON with plain shell interpolation, so reject
# anything that would need escaping rather than producing a broken config.
case "${S3_ACCESS_KEY}${S3_SECRET_KEY}" in
	*[!A-Za-z0-9._-]*)
		echo "S3_ACCESS_KEY and S3_SECRET_KEY may only use letters, digits, dot, underscore or hyphen." >&2
		exit 1
		;;
esac

cat > /tmp/s3.json <<EOF
{
  "identities": [
    {
      "name": "handoff",
      "credentials": [
        {
          "accessKey": "${S3_ACCESS_KEY}",
          "secretKey": "${S3_SECRET_KEY}"
        }
      ],
      "actions": ["Admin", "Read", "Write", "List", "Tagging", "Locking"]
    }
  ]
}
EOF

# The image entrypoint fixes /data ownership, drops to the seaweed user and
# dispatches the `server` command. Replacing it here instead of replacing the
# file keeps that behaviour intact.
exec /entrypoint.sh "$@"
