export function shouldRunAwsIntegrationTests(): boolean {
  return process.env.RUN_AWS_INTEGRATION_TESTS === "1";
}
