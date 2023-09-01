/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"log"
	"net"
	"sync"
)

func DoIocpJob(conn net.Conn, ps *PlayerSession, wg *sync.WaitGroup) {
	defer ps.mConn.Close()
	defer wg.Done()

	var buf [1024]byte
	var playerId string

	for {
		n, err := ps.mConn.Read(buf[0:])

		if checkError(err) {
			log.Print("Exiting go routine")
			break
		}

		if n < 4 {
			log.Print("Read Error too short length: ", n)
			ps.Disconnect(DR_ACTIVE)
			return
		}

		// assume Intel CPU (little Endian)
		mSize := binary.LittleEndian.Uint16(buf[0:2])
		mType := binary.LittleEndian.Uint16(buf[2:4])

		fmt.Println("size: ", mSize)
		fmt.Println("type: ", mType)

		if mType >= uint16(PKT_MAX) || mType <= uint16(PKT_NONE) {
			ps.Disconnect(DR_ACTIVE)
			return
		}

		switch PacketTypes(mType) {
		case PKT_CS_START:
			if mSize > 2+2+MAX_SESSION_LEN {
				log.Print("PKT_CS_START size too short length: ", mSize)
				ps.Disconnect(DR_ACTIVE)
				return
			}
			playerId = string(bytes.Trim(buf[4:], "\u0000"))
			Handler_PKT_CS_START(ps, playerId)

		case PKT_CS_EXIT:
			if mSize > 2+2+MAX_SESSION_LEN {
				log.Print("PKT_CS_EXIT size too short length: ", mSize)
				ps.Disconnect(DR_ACTIVE)
				return
			}
			playerId = string(bytes.Trim(buf[4:], "\u0000"))
			Handler_PKT_CS_EXIT(ps, playerId)

		case PKT_CS_PUT_STONE:
			if mSize > 12 {
				log.Print("PKT_CS_PUT_STONE size too short length: ", mSize)
				ps.Disconnect(DR_ACTIVE)
				return
			}

			xpos := binary.LittleEndian.Uint32(buf[4:8])
			ypos := binary.LittleEndian.Uint32(buf[8:12])

			Handler_PKT_CS_PUT_STONE(ps, int(xpos), int(ypos))

		case PKT_CS_PING:
			if mSize > 2+2+MAX_SESSION_LEN {
				log.Print("PKT_CS_PING size too short length: ", mSize)
				ps.Disconnect(DR_ACTIVE)
				return
			}
			playerId = string(bytes.Trim(buf[4:], "\u0000"))
			Handler_PKT_CS_PING(playerId)

		default:
			log.Print("Error Unknown messge type: ", mType)
		}
	}
}

func Handler_PKT_CS_START(session *PlayerSession, playerId string) {
	log.Print("PKT_CS_START from ", playerId)
	session.PlayerReady(playerId)
}

func Handler_PKT_CS_EXIT(session *PlayerSession, playerId string) {
	log.Print("PKT_CS_EXIT from ", playerId)
	session.PlayerExit(playerId)
}

func Handler_PKT_CS_PUT_STONE(session *PlayerSession, xpos int, ypos int) {
	session.mGameLiftManager.mGameSession.PutStone(session, xpos, ypos)
}

func Handler_PKT_CS_PING(playerId string) {
	log.Print("PKT_CS_PING from ", playerId)
}
