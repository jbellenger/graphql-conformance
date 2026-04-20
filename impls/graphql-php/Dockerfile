FROM composer:2 AS deps
WORKDIR /app
COPY composer.json /app/
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress

FROM php:8.3-cli

WORKDIR /app
COPY --from=deps /app/vendor /app/vendor
COPY server.php /app/server.php

EXPOSE 8080
CMD ["php", "-S", "0.0.0.0:8080", "/app/server.php"]
