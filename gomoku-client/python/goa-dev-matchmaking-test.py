#!/usr/bin/env python3

import requests
import uuid
import time
import socket
import struct
import threading
import json
import os
from urllib.parse import urljoin

# Get API Gateway URL from environment variable
try:
    api_base_url = os.environ['API_GATEWAY_URL']
except KeyError:
    raise EnvironmentError(
        "API_GATEWAY_URL environment variable is not set. "
        "Please set it using: export API_GATEWAY_URL='https://your-api-gateway-id.execute-api.region.amazonaws.com/prod'"
    )

# Construct endpoint URLs
match_request_url = urljoin(api_base_url, 'matchrequest')
match_status_url = urljoin(api_base_url, 'matchstatus')

numOfPlayers = 8
clients = [] # List of client
threads = []

PKT_CS_START        = 1
PKT_SC_START        = 2
PKT_CS_PUT_STONE    = 21
PKT_SC_BOARD_STATUS = 22
PKT_CS_EXIT         = 31
PKT_CS_PING	        = 41

PKT_CS_START_SIZE   = 132 # size(2) + type(2) + playerID(128)
PKT_CS_EXIT_SIZE    = 132 # size(2) + type(2) + playerID(128)
PKT_SC_START_SIZE   = 196 # size(2) + type(2) + playerID(128) + opponentName(64)
PKT_CS_PING_SIZE    = 132 # size(2) + type(2) + playerID(128)

is_exiting = False

def thread_function(client, i):
  sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
  # Enable TCP Keep alive. AWS Global Accelerator has TCP idle timeout of 340s 
  sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
# sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPALIVE, 1) # TCP_KEEPALIVE not supported on MAC
  sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPINTVL, 30)
  sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_KEEPCNT, 3)

  addr = (client['ipaddr'], client['port'])
  sock.connect(addr)
  print('[player', i, '] connected to game server')

  var = struct.pack('hh128s', PKT_CS_START_SIZE, PKT_CS_START, 
      bytes(str(client['sessionId']), encoding='utf-8'))
  #print(var)
  sock.send(var);
  print('[player', i, '] StartRequest sent to game server')

  try:
    data = sock.recv(PKT_SC_START_SIZE)
    if not data:
      print('[player', i, '] no data recevied')
    else:
      print('[player', i, '] GameStartBroadcast received')
  except ConnectionResetError as e:
    print('[player', i,'] error', e)

  t = 0 
  while t < 30:
    if is_exiting == True: 
      var = struct.pack('hh128s', PKT_CS_EXIT_SIZE, PKT_CS_EXIT, 
            bytes(str(client['sessionId']), encoding='utf-8'))
      sock.send(var);
      print('[player', i, '] ExitRequest sent to game server')
      sock.close
      break

    t = t + 1
    if t == 30 : # send ClientPing every 30 sec.
      #var = struct.pack('hh128s', PKT_CS_PING_SIZE , PKT_CS_PING, bytes(str(client['sessionId']), encoding='utf-8'))
      #sock.send(var);
      print('[player', i,'] ClientPing sent to server skipped...')
      t = 0
    time.sleep(1)

def main():
  global is_exiting

  numOfConnected = 0

  # Initialize game client attributes
  for i in range (numOfPlayers):
    client = {}

    client['playerName'] = f"Player{i+1}"
    client['TicketStatus'] = 'IDLE'
    client['ticketId'] = ''
    client['playerAttr'] = {'score': {'N': 1000 }}
    client['ipaddr'] = ''
    client['port'] = 0
    clients.append(client)
    
  # Start Matchmaking request
  for i in range (numOfPlayers):
    match_request_payload = {
      "PlayerName": clients[i]['playerName']
    }

    try:
      match_response = requests.post(
        match_request_url,
        json=match_request_payload,
        headers={'Content-Type': 'application/json'}
      )
            
      match_response.raise_for_status()
      response_data = match_response.json()
      clients[i]['ticketId'] = response_data['TicketId']
      print("[player", i, "] matchmaking request sent via API Gateway. ticketId :",clients[i]['ticketId'])
      
      time.sleep(0.3)
    except requests.exceptions.RequestException as e:
      print(f"API request failed for player {i}: {str(e)}")

  time.sleep(1)

  # Wait until all matchmaking requests succeeded with 'COMPLETED'
  while numOfConnected < numOfPlayers :
    for i in range (numOfPlayers):
      if clients[i]['TicketStatus'] != 'COMPLETED':
          match_status_payload = {
            "PlayerName": clients[i]['playerName'],
            "TicketId": clients[i]['ticketId']
          }

          try:
            match_response = requests.post(
              match_status_url,
              json=match_status_payload,
              headers={'Content-Type': 'application/json'}
            )

            match_response.raise_for_status()
            response_data = match_response.json()

            if(response_data['IpAddress'] != '' and response_data['Port'] != 0):
              clients[i]['TicketStatus'] = 'COMPLETED'
              clients[i]['ipaddr']       = response_data['IpAddress']
              clients[i]['port']         = response_data['Port']
              clients[i]['sessionId']     = response_data['PlayerSessionId']
              print("[player", i, "] match created. ipaddr: ", clients[i]['ipaddr'], " port: ", clients[i]['port'], " sessionId : ", clients[i]['sessionId'])

              numOfConnected = numOfConnected + 1
            else:
              print("[player", i, "] matchmaking status: not completed ")

          except requests.exceptions.RequestException as e:
            print(f"Status check failed for player {i}: {str(e)}")
 
          time.sleep(1)

  # Start thread for each client to communicate with game server 
  for i in range (numOfPlayers):
    try: 
      t = threading.Thread(target = thread_function, args = (clients[i], i))
      t.start()
      threads.append(t)
    except:
      print('error: unable to start thread')

  time.sleep(1)
  input("Please enter any key to terminate game sessions: \n")
  is_exiting = True

  for i, t in enumerate(threads) :
    t.join()
    print('[player', i, '] thread done')
      
  print("Exiting...")

if __name__ == "__main__":
    main()