FROM ruby:4.0-slim

WORKDIR /app
COPY Gemfile Gemfile.lock /app/
RUN bundle install --jobs 4 --retry 3 \
 && ruby -e "require 'graphql'; print GraphQL::VERSION" > /impl-version
COPY server.rb /app/server.rb

EXPOSE 8080
CMD ["bundle", "exec", "ruby", "/app/server.rb"]
