FROM ruby:4.0-slim

WORKDIR /app
RUN gem install graphql --no-document \
 && gem install webrick --no-document \
 && ruby -e "require 'graphql'; print GraphQL::VERSION" > /impl-version
COPY server.rb /app/server.rb

EXPOSE 8080
CMD ["ruby", "/app/server.rb"]
