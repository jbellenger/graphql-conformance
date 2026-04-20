FROM ruby:3.3-slim

WORKDIR /app
RUN gem install graphql --no-document \
 && gem install webrick --no-document
COPY server.rb /app/server.rb

EXPOSE 8080
CMD ["ruby", "/app/server.rb"]
