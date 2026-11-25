# Encrypted, deduplicated nightly backups: pg_dump → restic (local disk, S3/R2, B2, SFTP…).
FROM postgres:18-alpine@sha256:9ba53c7d41ea093baf5c1ba635ba5434c4f979880527d49bb7d9237d3193085b
RUN apk add --no-cache restic tini tzdata
COPY mm-backup.sh /usr/local/bin/mm-backup
RUN chmod 0755 /usr/local/bin/mm-backup
ENV RESTIC_CACHE_DIR=/tmp/restic-cache
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/mm-backup"]
CMD ["schedule"]
