FROM composer:2 AS deps
WORKDIR /app
COPY composer.json /app/
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress \
 && composer show webonyx/graphql-php --format=json \
      | php -r "\$v = json_decode(stream_get_contents(STDIN), true)['versions'][0]; echo ltrim(\$v, 'v');" > /impl-version

FROM php:8.5-cli

WORKDIR /app
COPY --from=deps /app/vendor /app/vendor
COPY --from=deps /impl-version /impl-version
COPY server.php /app/server.php

EXPOSE 8080
CMD ["php", "-S", "0.0.0.0:8080", "/app/server.php"]
