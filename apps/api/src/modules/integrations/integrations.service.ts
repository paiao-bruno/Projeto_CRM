import { Injectable } from "@nestjs/common";
import { SgpClientService } from "./sgp/sgp-client.service";
import { SgpDiscoveryRequest } from "./sgp/types/sgp-client.types";

@Injectable()
export class IntegrationsService {
  constructor(private readonly sgpClient: SgpClientService) {}

  async testSgpAuth(request: SgpDiscoveryRequest = {}) {
    const response = await this.sgpClient.testAuth(
      request.payload,
      request.endpoint,
    );
    return response.body;
  }

  async discoverSgpCustomers(request: SgpDiscoveryRequest = {}) {
    const response = await this.sgpClient.discoverCustomers(
      request.payload,
      request.endpoint,
    );
    return response.body;
  }
}
