FROM mcr.microsoft.com/dotnet/sdk:8.0 AS builder

WORKDIR /src
COPY Conformer.csproj ./
RUN dotnet restore
COPY Program.cs ./
RUN dotnet publish -c Release -o /app /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=builder /app ./

EXPOSE 8080
ENTRYPOINT ["dotnet", "Conformer.dll"]
