FROM mcr.microsoft.com/dotnet/sdk:10.0 AS builder

WORKDIR /src
COPY Conformer.csproj ./
RUN dotnet restore
COPY Program.cs ./
RUN dotnet publish -c Release -o /app /p:UseAppHost=false \
 && dotnet list package \
      | awk '/> GraphQL / {print $NF}' > /impl-version

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=builder /app ./
COPY --from=builder /impl-version /impl-version

EXPOSE 8080
ENTRYPOINT ["dotnet", "Conformer.dll"]
