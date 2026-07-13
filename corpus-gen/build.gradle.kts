val viaductVersion = "1.1.0"

plugins {
    kotlin("jvm") version "2.4.0"
    id("com.gradleup.shadow") version "9.5.1"
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("com.airbnb.viaduct.shared:arbitrary:$viaductVersion")
    implementation("com.airbnb.viaduct.engine:api:$viaductVersion")
    implementation("com.graphql-java:graphql-java:26.0")
    implementation("io.kotest:kotest-property-jvm:5.9.1")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.22.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.11.0")

    testImplementation(testFixtures("com.airbnb.viaduct.shared:arbitrary:$viaductVersion"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    testImplementation("org.junit.jupiter:junit-jupiter:6.1.2")
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
