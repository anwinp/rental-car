FROM postgres:16

RUN apt-get update && apt-get install -y \
    postgresql-16-partman \
    postgresql-16-cron \
    && rm -rf /var/lib/apt/lists/*

# Enable pg_cron in shared_preload_libraries
RUN echo "shared_preload_libraries = 'pg_partman_bgw,pg_cron'" >> /usr/share/postgresql/postgresql.conf.sample \
    && echo "pg_cron.database = 'rcm_dev'" >> /usr/share/postgresql/postgresql.conf.sample \
    && echo "pg_partman_bgw.dbname = 'rcm_dev'" >> /usr/share/postgresql/postgresql.conf.sample \
    && echo "pg_partman_bgw.interval = 3600" >> /usr/share/postgresql/postgresql.conf.sample
