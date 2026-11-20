FROM php:8.6-cli AS base

# Keep Composer's platform checks and the driver runtime on the same PHP setup.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libonig-dev \
 && docker-php-ext-install mbstring \
 && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY composer.json /app/
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress \
 && composer show webonyx/graphql-php --format=json \
      | php -r "\$v = json_decode(stream_get_contents(STDIN), true)['versions'][0]; echo ltrim(\$v, 'v');" > /impl-version

FROM base

WORKDIR /app
COPY --from=deps /app/vendor /app/vendor
COPY --from=deps /impl-version /impl-version
COPY server.php /app/server.php

EXPOSE 8080
CMD ["php", "-S", "0.0.0.0:8080", "/app/server.php"]
