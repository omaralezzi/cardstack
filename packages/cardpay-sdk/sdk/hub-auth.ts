import Web3 from 'web3';
import { networkName, signTypedData } from './utils';
import { networkIds } from './constants';

interface NonceResponse {
  data: {
    attributes: {
      nonce: string;
      version: string;
    };
  };
}

export default class HubAuth {
  constructor(private layer2Web3: Web3, private hubHost: string) {}

  async getNonce(): Promise<NonceResponse> {
    let url = `http://${this.hubHost}/api/session`;
    let response = await global.fetch(url, {
      headers: {
        //eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/vnd.api+json',
      },
    });
    if (response.status !== 401) {
      console.error('Failure fetching nonce', await response.text());
      throw new Error('Failure fetching nonce');
    }
    let responseJson = await response.json();
    return responseJson;
  }

  async authenticate(): Promise<string> {
    let ownerAddress = (await this.layer2Web3.eth.getAccounts())[0];
    let { nonce, version } = (await this.getNonce()).data.attributes;
    let name = await networkName(this.layer2Web3);
    let chainId = networkIds[name];
    const typedData = {
      types: {
        //eslint-disable-next-line @typescript-eslint/naming-convention
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
        ],
        //eslint-disable-next-line @typescript-eslint/naming-convention
        Authentication: [
          { name: 'user', type: 'address' },
          { name: 'nonce', type: 'string' },
        ],
      },
      domain: {
        name: this.hubHost,
        version,
        chainId,
      },
      primaryType: 'Authentication',
      message: {
        user: ownerAddress,
        nonce: nonce,
      },
    };
    let signature = await signTypedData(this.layer2Web3, ownerAddress, typedData);
    let postBody = JSON.stringify({
      data: {
        attributes: {
          authData: typedData,
          signature,
        },
      },
    });
    console.log(postBody);
    let response = await global.fetch(`http://${this.hubHost}/api/session`, {
      method: 'POST',
      headers: {
        //eslint-disable-next-line @typescript-eslint/naming-convention
        'Content-Type': 'application/vnd.api+json',
      },
      body: postBody,
    });
    if (response.ok) {
      let responseJson = await response.json();
      return responseJson.data.attributes.authToken;
    } else {
      // TODO: throw error?
      return '';
    }
  }
}
