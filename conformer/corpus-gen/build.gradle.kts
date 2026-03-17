val viaductVersion = "0.24.0"

plugins {
    kotlin("jvm") version "2.3.20"
    id("com.gradleup.shadow") version "8.3.9"
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("com.airbnb.viaduct:shared-arbitrary:$viaductVersion")
    implementation("com.airbnb.viaduct:engine-api:$viaductVersion")
    implementation("com.graphql-java:graphql-java:25.0")
    implementation("io.kotest:kotest-property-jvm:5.9.1")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.17.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.8.1")

    testImplementation(testFixtures("com.airbnb.viaduct:shared-arbitrary:$viaductVersion"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
    jvmArgs = listOf("-Xmx8g")
    systemProperty("junit.jupiter.execution.parallel.enabled", "true")
    systemProperty("junit.jupiter.execution.parallel.mode.default", "concurrent")
    systemProperty("junit.jupiter.execution.parallel.mode.classes.default", "concurrent")
}

tasks.jar {
    manifest {
        attributes("Main-Class" to "conformer.gen.MainKt")
    }
}
