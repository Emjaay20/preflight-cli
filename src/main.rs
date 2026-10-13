use std::env;
use std::net::{TcpListener, TcpStream};
use std::io::{Read, Write};

fn handle_client(mut stream: TcpStream) {
    let mut buffer = [0; 512];
    let _ = stream.read(&mut buffer);
    let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body><h1>Preflight CLI</h1></body></html>";
    let _ = stream.write(response.as_bytes());
}

fn start_server() {
    let listener = TcpListener::bind("0.0.0.0:8000").expect("Could not bind");
    for stream in listener.incoming() {
        if let Ok(stream) = stream {
            handle_client(stream);
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() > 1 {
        // Placeholder for CLI subcommands
        println!("Running command: {}", args[1]);
    } else {
        println!("Starting HTTP server on port 8000");
        start_server();
    }
}
